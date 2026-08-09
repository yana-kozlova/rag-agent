import { createResource } from '@/lib/actions/resources';
import { describeImage } from '@/lib/ai/vision';
import { storeImage } from '@/lib/storage/images';
import { getFileExtension } from '@/lib/utils/file-extraction';

/**
 * One image → one resource, for every surface that can receive one.
 *
 * Both entry points land here — the web upload route and Telegram photos —
 * because the interesting part is the order of the two side effects, and that
 * should not be decided twice.
 *
 * Reading comes first and storing second. Storing an image nobody can search
 * for makes it invisible to the assistant, which is the whole point of putting
 * it in the knowledge base; a description without a viewable copy is still
 * fully useful. So a failed description aborts, while a failed store is only
 * logged and the resource is saved without a URL.
 */

export type SaveImageInput = {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
  userId: string;
  /** Resource title. Falls back to the caption, then the filename. */
  title?: string | null;
  /** What the user wrote alongside the image, if anything. */
  caption?: string | null;
  /** Tagged onto telemetry so per-surface cost stays separable. */
  caller: string;
};

export type SaveImageResult =
  | {
      ok: true;
      resourceId: string;
      description: string;
      /** Null when the blob store is unconfigured or was unreachable. */
      imageUrl: string | null;
    }
  | { ok: false; error: string };

export async function saveImageResource({
  bytes,
  fileName,
  mimeType,
  userId,
  title,
  caption,
  caller,
}: SaveImageInput): Promise<SaveImageResult> {
  const description = await describeImage(bytes, mimeType, caller);
  if (!description.ok) {
    return { ok: false, error: description.error };
  }

  const stored = await storeImage(bytes, fileName, mimeType, userId);

  const result = await createResource({
    content: buildContent(description.text, caption),
    title: title?.trim() || caption?.trim() || fileName,
    metadata: {
      type: 'image',
      fileName,
      mimeType,
      fileSize: bytes.length,
      fileExtension: getFileExtension(fileName),
      ...(stored ? { imageUrl: stored.url, imagePathname: stored.pathname } : {}),
      ...(caption?.trim() ? { caption: caption.trim() } : {}),
    },
  });

  if (!result.success || !result.id) {
    return { ok: false, error: result.message || 'Failed to save the image' };
  }

  return {
    ok: true,
    resourceId: result.id,
    description: description.text,
    imageUrl: stored?.url ?? null,
  };
}

/**
 * The caption leads.
 *
 * "Receipt from the vet" is what the user will search for months later; the
 * model's description supplies the words they will have forgotten. Both are
 * embedded, and putting the user's own phrasing in the first chunk is what
 * makes the obvious query hit.
 */
function buildContent(description: string, caption?: string | null): string {
  const trimmed = caption?.trim();
  return trimmed ? `${trimmed}\n\n${description}` : description;
}
