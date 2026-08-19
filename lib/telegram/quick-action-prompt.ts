/**
 * The wire format for asking a quick action's value over Telegram.
 *
 * A callback press carries no conversation, and there is nowhere to keep
 * "waiting for a number" without inventing session state for one feature. So
 * the prompt is sent as a `force_reply` and the answer is matched back by the
 * label quoted inside it — the label is unique per user by database
 * constraint, which is what makes that lookup exact rather than a guess.
 *
 * Its own module, and dependency-free, so the code building the prompt and the
 * code reading the reply can share the format without importing each other —
 * the same arrangement as `callback-data.ts`, and the same reason: a format
 * defined in two places is a format that drifts.
 */

/** Guillemets around the label. What the reply is matched on. */
export const LABEL_OPEN = '«';
export const LABEL_CLOSE = '»';

/** The prompt text for one button and the values it wants. */
export function buildPromptText(label: string, prompts: string[]): string {
  return [
    `${LABEL_OPEN}${label}${LABEL_CLOSE}`,
    prompts.length === 1
      ? `Надішли у відповідь: ${prompts[0]}`
      : `Надішли у відповідь через кому: ${prompts.join(', ')}`,
  ].join('\n');
}

/** The label a prompt was about, read back out of the quoted message. */
export function labelFromPrompt(text: string | undefined | null): string | null {
  if (!text) return null;

  const open = text.indexOf(LABEL_OPEN);
  if (open === -1) return null;

  const close = text.indexOf(LABEL_CLOSE, open + 1);
  if (close === -1) return null;

  return text.slice(open + 1, close).trim() || null;
}

/**
 * One reply, N values.
 *
 * Split on commas, but never into more parts than there are questions — the
 * last field keeps whatever commas are left, because it is usually the
 * free-text note and "37.2, погано спав, знову" is one note with two commas in
 * it. With a single question there is no split at all, for the same reason.
 *
 * Fewer values than asked come back as fewer, not shifted: the resolver
 * reports the empty one by name, and guessing which field was skipped is how a
 * temperature ends up in the notes column.
 */
export function splitAnswers(text: string, count: number): string[] {
  const trimmed = text.trim();
  if (count <= 1) return [trimmed];

  const parts = trimmed.split(',');
  if (parts.length <= count) return parts.map((p) => p.trim());

  return [
    ...parts.slice(0, count - 1).map((p) => p.trim()),
    parts.slice(count - 1).join(',').trim(),
  ];
}
