import { del, put } from '@vercel/blob';
import { env } from '@/lib/env.mjs';

/**
 * Where uploaded images live.
 *
 * Everything else in this app is text and fits in Postgres; an image does not,
 * so the bytes go to Vercel Blob and only the URL is stored on the resource.
 *
 * Storing is optional on purpose. A missing token degrades the feature to
 * "the assistant read your image but cannot show it back" rather than breaking
 * the upload — which matters because reading is the part the knowledge base
 * actually depends on, and local development rarely has a Blob store attached.
 */

/** Vercel Blob has no private access tier; see `storeImage` on what follows. */
const ACCESS = 'public' as const;

/** A year. Images here are immutable — a new upload gets a new URL. */
const CACHE_MAX_AGE_SECONDS = 31_536_000;

export function isImageStorageConfigured(): boolean {
  return Boolean(env.BLOB_READ_WRITE_TOKEN);
}

export type StoredImage = {
  url: string;
  /** Blob's own path, needed to delete the object when the resource is deleted. */
  pathname: string;
};

/**
 * Put an image in the blob store and hand back its URL.
 *
 * Returns null rather than throwing: the caller has already spent a vision call
 * on this image, and losing the description too because the store was
 * unreachable would be the worse outcome.
 *
 * On privacy — Vercel Blob serves every object publicly, so the URL is the only
 * thing standing between an image and the open internet. `addRandomSuffix`
 * makes that URL unguessable, which is the same protection an unlisted link
 * gives. Do not use this for anything that would be harmful if the URL leaked.
 */
export async function storeImage(
  bytes: Buffer,
  filename: string,
  mimeType: string,
  userId: string
): Promise<StoredImage | null> {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.warn('[storage/images] BLOB_READ_WRITE_TOKEN is unset; image will not be viewable');
    return null;
  }

  try {
    const blob = await put(`images/${userId}/${safeName(filename)}`, bytes, {
      access: ACCESS,
      token,
      contentType: mimeType,
      addRandomSuffix: true,
      cacheControlMaxAge: CACHE_MAX_AGE_SECONDS,
    });

    return { url: blob.url, pathname: blob.pathname };
  } catch (error) {
    console.error('[storage/images] upload failed:', error);
    return null;
  }
}

/**
 * Remove a stored image.
 *
 * Called when the resource describing it is deleted — otherwise "forget this"
 * would leave the picture itself sitting on a public URL, which is the one
 * outcome someone deleting an image would not expect.
 *
 * Best-effort by design: the row is the record of truth, and a delete that
 * refused to remove it because the blob store was down would leave the user
 * unable to forget anything at all.
 */
export async function deleteStoredImage(url: string): Promise<void> {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;

  try {
    await del(url, { token });
  } catch (error) {
    console.error('[storage/images] delete failed (orphan left behind):', error);
  }
}

/**
 * Strip a filename down to what is safe in a URL path.
 *
 * Telegram photos arrive with no name at all and phone cameras produce names
 * with spaces and non-Latin characters; both would otherwise land in the
 * pathname verbatim.
 */
function safeName(filename: string): string {
  const cleaned = filename
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

  return cleaned || 'image';
}
