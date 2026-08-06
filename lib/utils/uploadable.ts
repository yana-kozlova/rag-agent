/**
 * What the upload controls offer, and what they reject before sending.
 *
 * Deliberately dependency-free. The authoritative extractors live in
 * `lib/utils/file-extraction.ts`, but that module pulls in `unpdf`, `mammoth`
 * and the AI SDK — importing it from a client component would ship all three to
 * the browser to answer the question "is this a .png?". Every consumer here is
 * a file picker or a drop zone, so a plain list of strings is the whole need.
 *
 * This is a courtesy check, not a security boundary: the server validates
 * independently, because a hand-crafted POST never sees any of it.
 */

/** Read by a vision model. Kept to the formats OpenAI's vision endpoint takes. */
export const UPLOADABLE_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const;

/** Read by a text extractor. */
export const UPLOADABLE_DOCUMENT_EXTENSIONS = ['pdf', 'docx', 'epub', 'txt', 'md'] as const;

export const UPLOADABLE_EXTENSIONS = [
  ...UPLOADABLE_DOCUMENT_EXTENSIONS,
  ...UPLOADABLE_IMAGE_EXTENSIONS,
] as const;

/** Alias kept for the composer, which reads as a permission check. */
export const ALLOWED_EXTENSIONS: readonly string[] = UPLOADABLE_EXTENSIONS;

/**
 * Matches the server's cap in `/api/resources/upload`.
 *
 * Worth checking twice: rejecting a 40MB photo in the browser costs nothing,
 * while discovering the limit after uploading it over a phone connection is the
 * kind of thing that stops someone using the feature.
 */
export const MAX_UPLOAD_SIZE_MB = 10;

/** For the `accept` attribute of a file input. */
export const UPLOAD_ACCEPT_ATTRIBUTE = UPLOADABLE_EXTENSIONS.map((e) => `.${e}`).join(',');

/** Same string, named as the file inputs refer to it. */
export const ALLOWED_ACCEPT = UPLOAD_ACCEPT_ATTRIBUTE;

export function fileExtensionOf(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1]!.toLowerCase() : '';
}

export function isUploadableImage(fileName: string): boolean {
  return (UPLOADABLE_IMAGE_EXTENSIONS as readonly string[]).includes(fileExtensionOf(fileName));
}

export function isUploadable(fileName: string): boolean {
  return (UPLOADABLE_EXTENSIONS as readonly string[]).includes(fileExtensionOf(fileName));
}

/**
 * Is this attachment an image?
 *
 * Both signals are checked because neither is reliable alone: a browser sets
 * `type` correctly but some desktop clients send `application/octet-stream`,
 * while a file saved without an extension has only the type to go on.
 */
export function isImageAttachment(file: { name: string; type?: string }): boolean {
  if (file.type?.startsWith('image/')) return true;
  return isUploadableImage(file.name);
}

/**
 * Why a file was turned away, or null if it was not.
 *
 * Returns the message rather than a boolean because every caller needs to tell
 * the user something — silently dropping a dragged file reads as the drop zone
 * being broken, which is what the chat did before.
 */
export function rejectionReason(file: { name: string; size: number }): string | null {
  if (file.size > MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
    return `${file.name} — більше за ${MAX_UPLOAD_SIZE_MB}MB`;
  }
  if (!isUploadable(file.name)) {
    return `${file.name} — непідтримуваний тип. Можна: ${UPLOADABLE_EXTENSIONS.join(', ')}`;
  }
  return null;
}
