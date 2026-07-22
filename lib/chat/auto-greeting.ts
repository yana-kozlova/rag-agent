/**
 * Marks the daily greeting prompt, which the app sends on the user's behalf but
 * the user never typed. Both ends read this: the server skips persisting the
 * message, and the client hides it — so an implementation-detail prompt never
 * shows up as a fake "You:" bubble or lingers in history.
 *
 * Shared (no 'use client') so the chat route and the chat UI agree byte-for-byte
 * on what an auto-greeting looks like.
 */

// Zero-width wrapped, like the RESOURCE_IDS marker, so it's invisible if it ever
// leaks into rendered text.
export const AUTO_GREETING_MARKER = '\u200B\u200B[AUTO_GREETING]\u200B\u200B';

// Opening of the greeting prompt as it was sent before the marker existed, so
// already-saved greetings still get recognised and hidden.
const LEGACY_PREFIX = "Greet the user briefly and summarize today's";

/** True for both marker-tagged prompts and pre-marker ones already in history. */
export function isAutoGreetingText(text?: string | null): boolean {
  if (!text) return false;
  return text.includes(AUTO_GREETING_MARKER) || text.trimStart().startsWith(LEGACY_PREFIX);
}

/** Remove the marker so the model receives the plain prompt. */
export function stripAutoGreetingMarker(text: string): string {
  return text.split(AUTO_GREETING_MARKER).join('');
}
