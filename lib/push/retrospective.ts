import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { and, gte, eq } from 'drizzle-orm';
import { env } from '@/lib/env.mjs';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { logLlmUsage } from '@/lib/ai/telemetry';
import { GoogleCalendarService } from '@/lib/services/calendar';
import {
  type CalendarEvent,
  fetchEventsBetween,
  localDayBounds,
} from './calendar-window';

/** The retrospective covers the seven local days ending on the day it is sent. */
const WINDOW_DAYS = 7;

export type WeekStats = {
  eventCount: number;
  /** Scheduled hours, excluding all-day entries — those aren't time spent. */
  scheduledHours: number;
  /** Local weekday name with the most events, or null when the week was empty. */
  busiestDay: string | null;
  /** Recurring commitments, most frequent first. */
  topCommitments: Array<{ title: string; count: number }>;
  notesSaved: number;
  noteTitles: string[];
};

export type Retrospective = {
  title: string;
  body: string;
  stats: WeekStats;
};

/** Events across the user's calendars for the week ending today (local). */
export async function fetchWeekEvents(
  calendarService: GoogleCalendarService,
  userId: string,
  now: Date,
  tz: string
): Promise<CalendarEvent[]> {
  const { timeMin, timeMax } = localDayBounds(now, tz, WINDOW_DAYS - 1);
  // A week of calendars needs a far higher cap than the daily briefing's 25.
  return fetchEventsBetween(calendarService, userId, timeMin, timeMax, 250);
}

/** The instant the local retrospective window opened, for date comparisons. */
export function weekStartInstant(now: Date, tz: string): Date {
  const { timeMin } = localDayBounds(now, tz, WINDOW_DAYS - 1);
  return new Date(timeMin);
}

/** Notes and documents the user saved during the window. */
export async function fetchWeekNotes(
  userId: string,
  since: Date
): Promise<Array<{ title: string | null; content: string }>> {
  try {
    return await db
      .select({ title: resources.title, content: resources.content })
      .from(resources)
      .where(and(eq(resources.userId, userId), gte(resources.createdAt, since)))
      .limit(50);
  } catch (error) {
    console.error('[push/retrospective] Note lookup failed:', error);
    return [];
  }
}

/** Reduce the raw week into the handful of numbers worth reporting. */
export function summarizeWeek(
  events: CalendarEvent[],
  notes: Array<{ title: string | null; content: string }>,
  tz: string
): WeekStats {
  const timed = events.filter((e) => !e.allDay && e.end);

  const scheduledMs = timed.reduce((total, e) => {
    const span = new Date(e.end!).getTime() - new Date(e.start).getTime();
    // Guard against malformed or inverted ranges rather than skewing the total.
    return total + (Number.isFinite(span) && span > 0 ? span : 0);
  }, 0);

  const perDay = new Map<string, number>();
  for (const e of events) {
    const day = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
    }).format(new Date(e.start));
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  const busiest = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0];

  // Titles that recur are the standing commitments — the thing a retrospective
  // is actually about. One-offs are noise at this altitude.
  const perTitle = new Map<string, number>();
  for (const e of events) {
    const key = e.title.trim();
    if (key) perTitle.set(key, (perTitle.get(key) ?? 0) + 1);
  }

  const topCommitments = [...perTitle.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([title, count]) => ({ title, count }));

  return {
    eventCount: events.length,
    scheduledHours: Math.round(scheduledMs / 3_600_000),
    busiestDay: busiest ? busiest[0] : null,
    topCommitments,
    notesSaved: notes.length,
    noteTitles: notes
      .map((n) => (n.title || n.content).trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 8),
  };
}

/**
 * Deterministic fallback body — used when there's no LLM key, when the model
 * call fails, or when the week was too empty to be worth a token.
 * A retrospective that always arrives matters more than a clever one.
 */
function plainRetrospective(stats: WeekStats): string {
  const parts: string[] = [];

  if (stats.eventCount > 0) {
    parts.push(`${stats.eventCount} ${stats.eventCount === 1 ? 'event' : 'events'}`);
  }
  if (stats.scheduledHours > 0) parts.push(`${stats.scheduledHours}h scheduled`);
  if (stats.busiestDay) parts.push(`busiest ${stats.busiestDay}`);
  if (stats.notesSaved > 0) {
    parts.push(`${stats.notesSaved} ${stats.notesSaved === 1 ? 'note' : 'notes'} saved`);
  }

  return parts.length > 0
    ? parts.join(' · ')
    : 'A quiet week — nothing scheduled and nothing saved.';
}

/**
 * Build the weekly retrospective: where the past week's time actually went,
 * plus what the user captured, condensed into notification-sized copy.
 */
export async function generateRetrospective(
  userId: string,
  events: CalendarEvent[],
  notes: Array<{ title: string | null; content: string }>,
  tz: string
): Promise<Retrospective> {
  const stats = summarizeWeek(events, notes, tz);

  // Nothing happened; there is no insight to draw and no reason to pay for one.
  if (stats.eventCount === 0 && stats.notesSaved === 0) {
    return {
      title: '🗓️ Your week',
      body: plainRetrospective(stats),
      stats,
    };
  }

  if (!env.OPENAI_API_KEY) {
    return { title: '🗓️ Your week', body: plainRetrospective(stats), stats };
  }

  const modelName = env.AI_CHAT_MODEL || 'gpt-4o-mini';
  const startedAt = Date.now();

  try {
    const { text, usage } = await generateText({
      model: openai(modelName),
      system: [
        'You write a single-sentence weekly retrospective for a push notification.',
        'Hard limit: 180 characters. No greeting, no emoji, no markdown, no preamble.',
        'Lead with the most telling pattern: where the hours actually went, a lopsided day, or a commitment that dominated the week.',
        'Ground every claim in the numbers given. Never invent events, hours, or trends you were not given.',
        'Write plainly and factually, like a competent assistant. Do not congratulate, coach, or moralise.',
      ].join(' '),
      prompt: [
        `Week just ended (timezone ${tz}):`,
        `- ${stats.eventCount} calendar events, ${stats.scheduledHours}h scheduled`,
        stats.busiestDay ? `- Busiest day: ${stats.busiestDay}` : '',
        stats.topCommitments.length > 0
          ? `- Recurring: ${stats.topCommitments.map((c) => `${c.title} (${c.count}x)`).join(', ')}`
          : '',
        `- ${stats.notesSaved} notes saved`,
        stats.noteTitles.length > 0 ? `- Note topics: ${stats.noteTitles.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });

    logLlmUsage({
      op: 'generateText',
      model: modelName,
      caller: 'push/retrospective',
      usage: usage
        ? {
            inputTokens: (usage as any).inputTokens ?? (usage as any).promptTokens,
            outputTokens: (usage as any).outputTokens ?? (usage as any).completionTokens,
            totalTokens: usage.totalTokens,
          }
        : undefined,
      durationMs: Date.now() - startedAt,
      note: `events=${stats.eventCount} notes=${stats.notesSaved}`,
    });

    const body = text.trim().slice(0, 180);

    return {
      title: `🗓️ Week in review · ${stats.scheduledHours}h`,
      body: body || plainRetrospective(stats),
      stats,
    };
  } catch (error) {
    console.error('[push/retrospective] Generation failed, using plain summary:', error);
    return { title: '🗓️ Your week', body: plainRetrospective(stats), stats };
  }
}
