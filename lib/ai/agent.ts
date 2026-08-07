import { openai } from '@ai-sdk/openai';
import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { tools } from '@/lib/ai/tools';
import { env } from '@/lib/env.mjs';
import { SYSTEM_PROMPT } from '@/app/prompts/system';
import { logLlmUsage } from '@/lib/ai/telemetry';
import { getUser } from '@/lib/auth/context';
import { listDirectives } from '@/lib/actions/directives';
import { renderDirectives } from '@/lib/directives/directives';

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
async function directiveBlock(): Promise<string> {
  try {
    const user = await getUser();
    if (!user?.id) return '';
    return renderDirectives(await listDirectives(user.id));
  } catch (error) {
    console.error('[agent] could not load response preferences:', error);
    return '';
  }
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
  return {
    model: openai(agentModelName()),
    system: SYSTEM_PROMPT
      .replace('{TOOLS}', Object.values(tools).map((t) => t.description).join('\n'))
      .replace('{TODAY_ISO}', new Date().toISOString().slice(0, 10))
      .replace('{DIRECTIVES}', await directiveBlock()),
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
