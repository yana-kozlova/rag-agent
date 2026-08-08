import { openai } from '@ai-sdk/openai';
import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { tools } from '@/lib/ai/tools';
import { env } from '@/lib/env.mjs';
import { SYSTEM_PROMPT } from '@/app/prompts/system';
import { logLlmUsage } from '@/lib/ai/telemetry';
import { getUser, type UserContext } from '@/lib/auth/context';
import { listDirectives } from '@/lib/actions/directives';
import { renderDirectives } from '@/lib/directives/directives';
import { todayFor } from '@/lib/actions/user-timezone';
import { DEFAULT_TIMEZONE, getLocalDateKey } from '@/lib/push/timezone';

/**
 * The one definition of what the assistant is: model, prompt, tools, step budget.
 *
 * Both entry points build on this — the web chat streams it, Telegram awaits a
 * finished answer. Keeping it here is what stops the two surfaces from drifting
 * into subtly different assistants.
 */

export function agentModelName(): string {
  return env.AI_CHAT_MODEL || 'gpt-4o-mini';
}

/**
 * The user's standing response preferences, rendered for the prompt.
 *
 * Degrades to an empty block instead of throwing, and that direction is
 * deliberate: a lost preference costs tone on one reply, while a thrown error
 * costs the reply. Same reason cron reads a bad locale as the default rather
 * than failing a send it has already paid for.
 */
async function directiveBlock(user: UserContext | null): Promise<string> {
  try {
    if (!user?.id) return '';
    return renderDirectives(await listDirectives(user.id));
  } catch (error) {
    console.error('[agent] could not load response preferences:', error);
    return '';
  }
}

/**
 * The date the assistant is told it is, in the user's own zone.
 *
 * This was `new Date().toISOString()` — the server's UTC day. At 01:00 in Kyiv
 * the server is still on yesterday, so the model computed "завтра" from
 * yesterday's date and handed that to `getEvents(date:)`, which then answered
 * with today's schedule while calling it tomorrow's. Nothing in the logs shows
 * it; the answer is confident and simply about the wrong day.
 *
 * `getEvents` already resolves the zone itself for its day boundaries — this is
 * the other half, the one the model does arithmetic on.
 *
 * Falls back to the deployment's zone rather than throwing, on the same terms as
 * everything else on this path: a system prompt is not worth losing a reply for,
 * and the default is still closer to the user than UTC is.
 */
async function promptToday(user: UserContext | null): Promise<string> {
  try {
    if (user?.id) return await todayFor(user.id);
  } catch (error) {
    console.error('[agent] could not resolve the user’s today:', error);
  }
  return getLocalDateKey(new Date(), DEFAULT_TIMEZONE);
}

/**
 * Spreadable into `streamText` or `generateText`; the caller adds `messages`.
 *
 * Async because the system prompt is now per-user — it carries whatever the
 * user has told the assistant about how to answer. Building it here rather than
 * at each entry point is what makes the bot in Telegram honour a preference set
 * in the web chat without either surface knowing the feature exists.
 */
export async function agentOptions() {
  // Resolved once and handed to both: the prompt needs the user for their
  // standing preferences and for what day it is where they are, and on the web
  // path `getUser()` costs a session read each time it is asked.
  const user = await getUser().catch((error) => {
    console.error('[agent] could not resolve the user:', error);
    return null;
  });

  return {
    model: openai(agentModelName()),
    system: SYSTEM_PROMPT
      .replace('{TOOLS}', Object.values(tools).map((t) => t.description).join('\n'))
      .replace('{TODAY_ISO}', await promptToday(user))
      .replace('{DIRECTIVES}', await directiveBlock(user)),
    tools,
    stopWhen: stepCountIs(env.AI_TOOL_STEPS ?? 5),
  };
}

type RunAgentOptions = {
  messages: ModelMessage[];
  /** Tagged onto telemetry so per-surface cost stays separable. */
  caller: string;
  abortSignal?: AbortSignal;
};

/**
 * Run the agent to a finished answer.
 *
 * For callers that cannot stream — Telegram sends whole messages, so there is
 * nothing to progressively render. Must run inside `runWithUser` unless a
 * NextAuth session is available, or every tool will fail to resolve the user.
 */
export async function runAgent({ messages, caller, abortSignal }: RunAgentOptions) {
  const startedAt = Date.now();

  const result = await generateText({
    ...(await agentOptions()),
    messages,
    abortSignal,
  });

  logLlmUsage({
    op: 'generateText',
    model: agentModelName(),
    caller,
    usage: result.usage
      ? {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
        }
      : undefined,
    durationMs: Date.now() - startedAt,
    note: result.finishReason ? `finish=${result.finishReason}` : undefined,
  });

  return result;
}
