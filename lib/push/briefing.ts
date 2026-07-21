import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { env } from '@/lib/env.mjs';
import { logLlmUsage } from '@/lib/ai/telemetry';
import { findRelevantContent } from '@/lib/ai/embedding';
import { GoogleCalendarService } from '@/lib/services/calendar';
import {
  type CalendarEvent,
  fetchEventsBetween,
  formatEventTime,
  localDayBounds,
} from './calendar-window';

export type BriefingEvent = CalendarEvent;

export type Briefing = {
  title: string;
  body: string;
  eventCount: number;
};

/** Everything on the user's calendars for their local today. */
export async function fetchTodayEvents(
  calendarService: GoogleCalendarService,
  userId: string,
  now: Date,
  tz: string
): Promise<BriefingEvent[]> {
  const { timeMin, timeMax } = localDayBounds(now, tz);
  return fetchEventsBetween(calendarService, userId, timeMin, timeMax, 25);
}

/**
 * Deterministic fallback body — used when there's no LLM key, when the model
 * call fails, or when there's simply nothing worth spending a token on.
 * A briefing that always arrives matters more than a clever one.
 */
function plainBriefing(events: BriefingEvent[], tz: string): string {
  if (events.length === 0) return 'Nothing scheduled today. Your calendar is clear.';

  const lines = events
    .slice(0, 4)
    .map((e) => `${formatEventTime(e, tz)} ${e.title}`);

  if (events.length > 4) lines.push(`+${events.length - 4} more`);

  return lines.join(' · ');
}

/**
 * Build the morning briefing: today's schedule, plus anything from the user's
 * saved notes that relates to it, condensed into notification-sized copy.
 */
export async function generateBriefing(
  userId: string,
  events: BriefingEvent[],
  tz: string
): Promise<Briefing> {
  const eventCount = events.length;

  if (eventCount === 0) {
    return {
      title: '☀️ Good morning',
      body: plainBriefing(events, tz),
      eventCount: 0,
    };
  }

  const scheduleText = events
    .map((e) => `- ${formatEventTime(e, tz)} ${e.title}${e.location ? ` (${e.location})` : ''}`)
    .join('\n');

  // Pull notes related to today's agenda so the briefing can surface context
  // the user saved earlier and has probably forgotten about.
  let notes = '';
  try {
    const topics = events.map((e) => e.title).join(', ');
    const relevant = await findRelevantContent(topics, userId, {
      caller: 'push/briefing',
    });
    if (Array.isArray(relevant) && relevant.length > 0) {
      notes = relevant
        .slice(0, 4)
        .map((r: any) => `- ${String(r.name ?? r.content ?? '').slice(0, 300)}`)
        .join('\n');
    }
  } catch (error) {
    console.error('[push/briefing] RAG lookup failed:', error);
  }

  if (!env.OPENAI_API_KEY) {
    return { title: '☀️ Good morning', body: plainBriefing(events, tz), eventCount };
  }

  const modelName = env.AI_CHAT_MODEL || 'gpt-4o-mini';
  const startedAt = Date.now();

  try {
    const { text, usage } = await generateText({
      model: openai(modelName),
      system: [
        'You write a single-sentence morning briefing for a push notification.',
        'Hard limit: 180 characters. No greeting, no emoji, no markdown, no preamble.',
        'Lead with what matters most: the first commitment, or a clash, or a tight gap.',
        'Mention times as HH:mm. If saved notes are relevant to a meeting, work in one concrete detail.',
        'Write plainly, like a competent assistant. Never invent events or details.',
      ].join(' '),
      prompt: [
        `Today's schedule (timezone ${tz}):`,
        scheduleText,
        notes ? `\nSaved notes that may be relevant:\n${notes}` : '',
      ].join('\n'),
    });

    logLlmUsage({
      op: 'generateText',
      model: modelName,
      caller: 'push/briefing',
      usage: usage
        ? {
            inputTokens: (usage as any).inputTokens ?? (usage as any).promptTokens,
            outputTokens: (usage as any).outputTokens ?? (usage as any).completionTokens,
            totalTokens: usage.totalTokens,
          }
        : undefined,
      durationMs: Date.now() - startedAt,
      note: `events=${eventCount}`,
    });

    const body = text.trim().slice(0, 180);

    return {
      title: `☀️ ${eventCount} ${eventCount === 1 ? 'thing' : 'things'} today`,
      body: body || plainBriefing(events, tz),
      eventCount,
    };
  } catch (error) {
    console.error('[push/briefing] Generation failed, using plain briefing:', error);
    return { title: '☀️ Good morning', body: plainBriefing(events, tz), eventCount };
  }
}
