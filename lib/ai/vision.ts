import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { env } from '@/lib/env.mjs';
import { logLlmUsage } from '@/lib/ai/telemetry';

/**
 * Images → text, so the rest of the pipeline never has to know about pixels.
 *
 * Every layer below this one — chunking, embedding, fact extraction, hybrid
 * search — operates on text. Rather than teach each of them about a second
 * modality, an uploaded image is turned into a description once, at the door,
 * and stored as the resource's content. A screenshot of a schedule then answers
 * schedule questions through exactly the same retrieval path as a typed note.
 *
 * The description is written to be *searched*, not read: it names what is in
 * the image and reproduces any text on it verbatim, because a query will
 * almost always match the words in a receipt or a slide rather than a summary
 * of them.
 */

/** What OpenAI's vision endpoint accepts. Anything else is rejected up front. */
export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export const SUPPORTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const;

export function isSupportedImageMimeType(mimeType: string): boolean {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType.toLowerCase());
}

/**
 * Vision runs on its own model setting.
 *
 * `AI_CHAT_MODEL` is documented as free to point at any model; if someone sets
 * it to a text-only one, uploads should not start failing. Defaults to the same
 * model the chat uses, which does read images.
 */
export function visionModelName(): string {
  return env.AI_VISION_MODEL || env.AI_CHAT_MODEL || 'gpt-4o-mini';
}

const PROMPT = [
  'Describe this image so it can be found later by search.',
  '',
  'Write, in order:',
  '1. One sentence naming what the image is (photo, screenshot, diagram, receipt, whiteboard, document scan, …) and what it shows.',
  '2. All text visible in the image, transcribed verbatim, preserving line order. Keep numbers, dates and names exactly as written. If there is no text, skip this.',
  '3. The details someone might search for: people, places, objects, dates, amounts, colours, what is happening.',
  '',
  'Write in the same language as the text in the image. If the image has no text, write in Ukrainian.',
  'Do not speculate about anything you cannot see. Do not add a preamble.',
].join('\n');

export type ImageDescription =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Read an image and return a searchable description of it.
 *
 * Never throws — an unreadable image should fail the one upload with a message,
 * not take down the route handling it.
 */
export async function describeImage(
  bytes: Buffer,
  mimeType: string,
  /** Tagged onto telemetry so per-surface cost stays separable. */
  caller: string
): Promise<ImageDescription> {
  if (!isSupportedImageMimeType(mimeType)) {
    return {
      ok: false,
      error: `Unsupported image type: ${mimeType}. Supported: JPEG, PNG, WebP, GIF`,
    };
  }

  const startedAt = Date.now();
  const model = visionModelName();

  try {
    const result = await generateText({
      model: openai(model),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image', image: new Uint8Array(bytes), mediaType: mimeType },
          ],
        },
      ],
    });

    logLlmUsage({
      op: 'generateText',
      model,
      caller,
      usage: result.usage
        ? {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
          }
        : undefined,
      durationMs: Date.now() - startedAt,
      note: `vision bytes=${bytes.length}`,
    });

    const text = result.text?.trim();
    if (!text) {
      return { ok: false, error: 'The image could not be read — nothing came back' };
    }

    return { ok: true, text };
  } catch (error) {
    console.error('[ai/vision] describeImage failed:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to read the image',
    };
  }
}
