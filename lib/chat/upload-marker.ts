/**
 * The hidden marker the chat attaches when files rode along with a message.
 *
 * Lives beside `auto-greeting.ts` and for the same reason: a marker is a
 * contract between the client that writes it and the route that reads it, and
 * while it was a regex inlined at both ends nothing could test that the two
 * halves still met.
 *
 * They had in fact come apart. The route matched the marker correctly, built the
 * `[FILES_UPLOADED]` instruction correctly — and wrote it to `message.content`,
 * which `convertToModelMessages` does not read. The model received the raw
 * zero-width marker out of `parts` and never the instruction, so the
 * `## File uploads` rule in the system prompt could not fire once and the agent
 * went looking for a just-uploaded file through `getInformation`. Nothing failed;
 * the answer was merely worse, every time.
 */

/** Zero-width wrapped, so it is invisible if it ever reaches a screen. */
const MARKER = /\u200B\u200B\[RESOURCE_IDS:([^\]]+)\]\u200B\u200B/;

/** Build the marker for a set of just-uploaded resources. */
export function uploadMarker(resourceIds: string[]): string {
  return `\u200B\u200B[RESOURCE_IDS:${resourceIds.join(',')}]\u200B\u200B`;
}

/** The resource ids a message carries, or null when it carries none. */
export function readUploadMarker(text: string): string[] | null {
  const match = MARKER.exec(text);
  if (!match) return null;

  const ids = match[1]
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return ids.length > 0 ? ids : null;
}

/** The message text with the marker taken back out. */
export function stripUploadMarker(text: string): string {
  return text.replace(MARKER, '').trim();
}

/**
 * What the model is told about files that arrived with this message.
 *
 * Spelled out rather than left to the system prompt alone: the ids are the whole
 * point, and `analyzeFile` can be called with them directly instead of searching
 * for a note written seconds ago that retrieval has no reason to rank highly.
 */
export function uploadInstruction(resourceIds: string[]): string {
  return (
    `[FILES_UPLOADED] ${resourceIds.length} file(s) have been uploaded to the knowledge base. ` +
    `Resource IDs: ${resourceIds.join(', ')}. ` +
    'Use analyzeFile with these resourceIds directly - DO NOT use getInformation. ' +
    'The files are already saved and available.'
  );
}

/**
 * Rewrite a message's text wherever text lives on it.
 *
 * `convertToModelMessages` reads `parts` and nothing else, so setting `content`
 * alone changes what the route logs and saves and nothing the model ever sees.
 * The first text part is the one replaced, because that is the part the text
 * being rewritten was read from; non-text parts (files, data) are left alone.
 */
export function withText<T extends { parts?: unknown }>(message: T, text: string): T {
  if (!Array.isArray(message?.parts)) {
    return { ...message, parts: [{ type: 'text', text }], content: text };
  }

  let replaced = false;
  const parts = message.parts.map((part: any) => {
    if (!replaced && part?.type === 'text') {
      replaced = true;
      return { ...part, text };
    }
    return part;
  });

  return {
    ...message,
    parts: replaced ? parts : [...parts, { type: 'text', text }],
    content: text,
  };
}
