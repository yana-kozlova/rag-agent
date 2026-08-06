import { createResource } from '@/lib/actions/resources';
import { saveImageResource, type SaveImageResult } from '@/lib/actions/save-image';
import { downloadFile } from '@/lib/telegram/api';
import {
  extractTextFromFile,
  getFileExtension,
  getMimeTypeFromExtension,
  isImageFile,
} from '@/lib/utils/file-extraction';
import { MAX_UPLOAD_SIZE_MB } from '@/lib/utils/uploadable';

/**
 * Photos and documents sent to the bot, turned into knowledge base entries.
 *
 * This is the path the phone actually uses. A recipe photographed in a kitchen
 * or a screenshot taken on the move never goes near the upload page — it gets
 * forwarded to the bot in the moment, and until now the bot answered "I only
 * understand text and voice" and dropped it.
 *
 * Kept out of `process.ts` because that file is about conversation flow, while
 * everything here is about getting bytes out of Telegram and into the same two
 * pipelines the web upload uses.
 */

/** Telegram sends a photo at several resolutions; this app wants the best one. */
export type TelegramPhotoSize = {
  file_id?: string;
  file_size?: number;
  width?: number;
  height?: number;
};

export type TelegramDocument = {
  file_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

/**
 * The web upload's cap, imported rather than repeated.
 *
 * Telegram's own `getFile` refuses anything over 20MB, so the effective ceiling
 * is lower than this anyway — but a shared number keeps "too big here, fine
 * there" from being a thing a user has to discover, and a comment promising the
 * two match is not the same as them matching.
 */
const MAX_FILE_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

export type MediaResult =
  | {
      ok: true;
      kind: 'image' | 'document';
      resourceId: string;
      title: string;
      /** What was read out of the file, for echoing back. */
      text: string;
      /** Null for documents, and for images the blob store could not take. */
      imageUrl: string | null;
    }
  | { ok: false; error: string };

/**
 * The largest size Telegram offered.
 *
 * The array is ordered smallest first, but that is a documented convention
 * rather than something the payload guarantees, so this compares rather than
 * taking the last element. Bigger is strictly better here: the vision model
 * reads text off the image, and a thumbnail is where that fails.
 */
/**
 * A saved image → the shape this module hands back.
 *
 * Both entry points reach this: a photo, and a document that turned out to be
 * an image. Shared so the two cannot drift into reporting the same save
 * differently.
 */
function toImageResult(saved: SaveImageResult, title: string): MediaResult {
  if (!saved.ok) return { ok: false, error: saved.error };

  return {
    ok: true,
    kind: 'image',
    resourceId: saved.resourceId,
    title,
    text: saved.description,
    imageUrl: saved.imageUrl,
  };
}

export function largestPhoto(sizes: TelegramPhotoSize[] | undefined): TelegramPhotoSize | null {
  if (!Array.isArray(sizes) || sizes.length === 0) return null;

  return sizes.reduce((best, candidate) => {
    const bestArea = (best.width ?? 0) * (best.height ?? 0);
    const candidateArea = (candidate.width ?? 0) * (candidate.height ?? 0);
    return candidateArea > bestArea ? candidate : best;
  });
}

/**
 * A photo message → a stored, described, searchable image.
 *
 * Telegram re-encodes every photo to JPEG, which is why nothing here worries
 * about HEIC: an iPhone picture arrives already converted.
 */
export async function ingestPhoto({
  sizes,
  caption,
  userId,
}: {
  sizes: TelegramPhotoSize[] | undefined;
  caption?: string | null;
  userId: string;
}): Promise<MediaResult> {
  const photo = largestPhoto(sizes);
  if (!photo?.file_id) return { ok: false, error: 'Не знайшла файл фото.' };

  if ((photo.file_size ?? 0) > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: `Фото більше за ${MAX_UPLOAD_SIZE_MB}MB — не подужаю.` };
  }

  const bytes = await downloadFile(photo.file_id);
  if (!bytes) return { ok: false, error: 'Не вдалось завантажити фото з Telegram.' };

  // Telegram gives photos no filename at all, so one is made up. The date is
  // there to make the knowledge base list readable — twenty rows called
  // "photo.jpg" tell you nothing.
  const fileName = `telegram-photo-${new Date().toISOString().slice(0, 10)}.jpg`;

  const saved = await saveImageResource({
    bytes,
    fileName,
    mimeType: 'image/jpeg',
    userId,
    caption,
    caller: 'telegram',
  });

  return toImageResult(saved, caption?.trim() || fileName);
}

/**
 * A document message → a knowledge base entry.
 *
 * Telegram calls everything sent with the paperclip a "document", including
 * images sent that way to avoid its compression — which is exactly what someone
 * does when the picture is a page of text worth keeping legible. So this checks
 * for an image first and hands those to the same path as a photo, rather than
 * failing on a file the app plainly supports.
 */
export async function ingestDocument({
  document,
  caption,
  userId,
}: {
  document: TelegramDocument;
  caption?: string | null;
  userId: string;
}): Promise<MediaResult> {
  if (!document.file_id) return { ok: false, error: 'Не знайшла файл.' };

  if ((document.file_size ?? 0) > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: `Файл більший за ${MAX_UPLOAD_SIZE_MB}MB — не подужаю.` };
  }

  const fileName = document.file_name?.trim() || 'file';
  const mimeType =
    document.mime_type || getMimeTypeFromExtension(getFileExtension(fileName));

  const bytes = await downloadFile(document.file_id);
  if (!bytes) return { ok: false, error: 'Не вдалось завантажити файл з Telegram.' };

  if (isImageFile(mimeType, fileName)) {
    const saved = await saveImageResource({
      bytes,
      fileName,
      mimeType,
      userId,
      caption,
      caller: 'telegram',
    });

    return toImageResult(saved, caption?.trim() || fileName);
  }

  // `File` rather than the buffer because that is what the extractors take —
  // they were written for a browser upload, and re-wrapping here is cheaper
  // than giving each of them a second entry point.
  const file = new File([new Uint8Array(bytes)], fileName, { type: mimeType });
  const extracted = await extractTextFromFile(file, mimeType, fileName, 'telegram');

  if (!extracted.success || !extracted.text?.trim()) {
    return {
      ok: false,
      error: extracted.error || 'З цього файлу не вдалось дістати текст.',
    };
  }

  const title = caption?.trim() || fileName;
  const result = await createResource({
    content: extracted.text,
    userId,
    title,
    metadata: {
      type: 'document',
      fileName,
      mimeType,
      fileSize: bytes.length,
      fileExtension: getFileExtension(fileName),
      ...(caption?.trim() ? { caption: caption.trim() } : {}),
    },
  });

  if (!result.success || !result.id) {
    return { ok: false, error: result.message || 'Не вдалось зберегти файл.' };
  }

  return {
    ok: true,
    kind: 'document',
    resourceId: result.id,
    title,
    text: extracted.text,
    imageUrl: null,
  };
}
