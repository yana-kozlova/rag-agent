import {
  convertToModelMessages,
  streamText,
  UIMessage,
} from 'ai';
import { z } from 'zod';
import { agentModelName, agentOptions } from '@/lib/ai/agent';
import { getUser } from '@/lib/auth/context';
import { saveUserMessage } from '@/lib/middleware/save-user-message';
import { logLlmUsage } from '@/lib/ai/telemetry';
import { AUTO_GREETING_MARKER, isAutoGreetingText, stripAutoGreetingMarker } from '@/lib/chat/auto-greeting';
import {
  readUploadMarker,
  stripUploadMarker,
  uploadInstruction,
  withText,
} from '@/lib/chat/upload-marker';

/** Pull the text out of a UIMessage regardless of which shape it arrived in. */
function extractText(m: any): string {
  if (typeof m?.content === 'string') return m.content;
  if (Array.isArray(m?.parts)) return m.parts.find((p: any) => p?.type === 'text')?.text ?? '';
  if (typeof m?.text === 'string') return m.text;
  return '';
}

/** Strip the auto-greeting marker from every place text can live on a message. */
function stripAutoGreetingFromMessage(m: any): any {
  const parts = Array.isArray(m?.parts)
    ? m.parts.map((p: any) =>
        p?.type === 'text' ? { ...p, text: stripAutoGreetingMarker(p.text ?? '') } : p
      )
    : m?.parts;
  const content = typeof m?.content === 'string' ? stripAutoGreetingMarker(m.content) : m?.content;
  return { ...m, parts, content };
}

/**
 * Tools run here, and tools resolve their user through `AsyncLocalStorage`,
 * which does not exist on the Edge runtime. This is the default today, but it
 * is the one invariant on this route that fails as a wrong answer rather than
 * an error — so it is declared rather than inherited, as every other route in
 * the app declares it.
 */
export const runtime = 'nodejs';

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

/**
 * What a turn may contain.
 *
 * The body used to be destructured straight out of `req.json()` and handed to
 * `convertToModelMessages`, with no schema, no cap on how many messages, and no
 * cap on their length. Every other route in the app validates its input; this
 * one both spends money per request and is the widest input surface there is.
 * The ceilings are generous — they exist to bound a runaway or a hostile body,
 * not to second-guess a long conversation.
 */
const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 100_000;

const chatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.string() }).passthrough())
    .min(1)
    .max(MAX_MESSAGES),
});

export async function POST(req: Request) {
  try {
    // This route is gated by `middleware.ts` like every other page, but it is
    // the only one that never checked for itself — and it is the one that runs
    // tools and spends tokens. A missing session here used to mean the model
    // still answered while every tool failed to resolve a user.
    const user = await getUser();
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const parsed = chatRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response('Bad Request', { status: 400 });
    }

    const messages = parsed.data.messages as unknown as UIMessage[];

    const oversized = messages.some((m: any) => extractText(m).length > MAX_MESSAGE_CHARS);
    if (oversized) {
      return new Response('Message too long', { status: 413 });
    }

    // Process messages - detect hidden resourceIds marker and add technical info
    const processedMessages = messages.map((m: any, idx: number) => {
      // Check if this is the last user message and contains resourceIds marker
      if (m.role === 'user' && idx === messages.length - 1) {
        // Get current message content
        const currentContent = extractText(m);

        // Auto-greeting: strip the marker so the model receives the plain
        // prompt. Persistence is skipped separately, off the raw content.
        if (currentContent.includes(AUTO_GREETING_MARKER)) {
          return stripAutoGreetingFromMessage(m);
        }

        // Files rode along with this message: swap the hidden marker for the
        // instruction naming their ids. Written through `withText` because
        // `convertToModelMessages` reads `parts` and nothing else — setting
        // `content` alone left the model holding the marker and no instruction.
        const resourceIds = readUploadMarker(currentContent);
        if (resourceIds) {
          const said = stripUploadMarker(currentContent);
          const fileInfo = uploadInstruction(resourceIds);

          return withText(m, said ? `${said}\n\n${fileInfo}` : fileInfo);
        }
      }
      return m;
    });

    // Middleware: Automatically save the last user message if it contains important information
    const lastUserMessage = processedMessages
      .filter(m => m.role === 'user')
      .pop();
    // Never persist a prompt the user didn't write. Checked on the raw message
    // (before the marker was stripped for the model above).
    const rawLastUser = messages.filter((m: any) => m.role === 'user').pop();
    const isAutoGreeting = isAutoGreetingText(extractText(rawLastUser));
    if (lastUserMessage && !isAutoGreeting) {
      const textContent = extractText(lastUserMessage);

      // Remove technical info before saving to messages table
      if (textContent) {
        const textForSaving = textContent.replace(/\n\n\[FILES_UPLOADED\].*$/s, '').trim();
        // Fire and forget - don't block the response
        saveUserMessage(textForSaving).catch(err => {
          console.error('Failed to save user message:', err);
        });
      }
    }

    const modelName = agentModelName();
    const streamStartedAt = Date.now();
    const result = streamText({
      // Model, prompt, tools and step budget are shared with the Telegram
      // entry point — see lib/ai/agent.ts.
      ...(await agentOptions()),
      messages: convertToModelMessages(processedMessages),
      abortSignal: (req as any).signal,
      onFinish: ({ usage, finishReason }: any) => {
        logLlmUsage({
          op: 'streamText',
          model: modelName,
          caller: 'api/chat',
          usage: usage
            ? {
                inputTokens: usage.inputTokens ?? usage.promptTokens,
                outputTokens: usage.outputTokens ?? usage.completionTokens,
                totalTokens: usage.totalTokens,
              }
            : undefined,
          durationMs: Date.now() - streamStartedAt,
          note: finishReason ? `finish=${finishReason}` : undefined,
        });
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.error(err);
    return new Response('Internal Server Error', { status: 500 });
  }
}