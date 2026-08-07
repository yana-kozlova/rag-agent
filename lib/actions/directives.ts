import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  assistantDirectives,
  rememberDirectiveSchema,
  type AssistantDirective,
} from '@/lib/db/schema/directives';
import {
  MAX_DIRECTIVES,
  MAX_DIRECTIVE_LENGTH,
  findDuplicate,
  matchDirective,
  normalizeDirective,
  type Directive,
  type DirectiveRejection,
  type DirectiveSource,
} from '@/lib/directives/directives';

function toDirective(row: AssistantDirective): Directive {
  return {
    id: row.id,
    text: row.text,
    source: row.source === 'inferred' ? 'inferred' : 'user',
    createdAt: row.createdAt,
  };
}

/**
 * Every standing instruction for a user, oldest first.
 *
 * Order is creation order rather than anything cleverer, because the prompt
 * renders them as a list and a list that reshuffles between turns makes the
 * cached prefix miss and the model's reading of "the first rule" drift.
 */
export async function listDirectives(userId: string): Promise<Directive[]> {
  const rows = await db
    .select()
    .from(assistantDirectives)
    .where(eq(assistantDirectives.userId, userId))
    .orderBy(asc(assistantDirectives.createdAt));

  return rows.map(toDirective);
}

export type RememberResult =
  | { ok: true; directive: Directive }
  | { ok: false; reason: DirectiveRejection; existing?: Directive; count?: number };

/**
 * Store a new standing instruction.
 *
 * Every rejection is reported rather than papered over. A duplicate is not
 * silently ignored, because the user watching the reply needs to know the rule
 * was already in force; a full list is not silently trimmed, because which of
 * twenty instructions they typed is expendable is not the model's call.
 */
export async function rememberDirective(
  userId: string,
  input: { text: string; source?: DirectiveSource }
): Promise<RememberResult> {
  const text = normalizeDirective(input.text ?? '');
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > MAX_DIRECTIVE_LENGTH) return { ok: false, reason: 'too-long' };

  const parsed = rememberDirectiveSchema.safeParse({ text, source: input.source ?? 'user' });
  if (!parsed.success) return { ok: false, reason: 'too-long' };

  const existing = await listDirectives(userId);

  const duplicate = findDuplicate(text, existing);
  if (duplicate) return { ok: false, reason: 'duplicate', existing: duplicate };

  if (existing.length >= MAX_DIRECTIVES) {
    return { ok: false, reason: 'full', count: existing.length };
  }

  const [row] = await db
    .insert(assistantDirectives)
    .values({ userId, text: parsed.data.text, source: parsed.data.source })
    .returning();

  return { ok: true, directive: toDirective(row) };
}

export type ForgetResult =
  | { ok: true; directive: Directive }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'ambiguous'; candidates: Directive[] };

export type UpdateResult =
  | { ok: true; directive: Directive }
  | { ok: false; reason: DirectiveRejection | 'not-found'; existing?: Directive };

/**
 * Rewrite one directive in place.
 *
 * Kept distinct from delete-then-add because these are ordered by creation and
 * that order is what the model reads as the shape of the list; retyping a rule
 * to fix a word would otherwise send it to the bottom. Editing is also the
 * common repair — a standing instruction is usually 90% right and one clause
 * too broad — so it must not cost the rule's place or its history.
 *
 * An edited directive always becomes `user`-sourced, whatever it was before:
 * the moment someone rewrites the model's reading of their habit, they have
 * authored it, and the "you didn't ask for this" badge would be a lie.
 */
export async function updateDirective(
  userId: string,
  id: string,
  rawText: string
): Promise<UpdateResult> {
  const text = normalizeDirective(rawText ?? '');
  if (!text) return { ok: false, reason: 'empty' };

  const parsed = rememberDirectiveSchema.safeParse({ text, source: 'user' });
  if (!parsed.success) return { ok: false, reason: 'too-long' };

  const existing = await listDirectives(userId);
  if (!existing.some((directive) => directive.id === id)) {
    return { ok: false, reason: 'not-found' };
  }

  // Against the others only — a rule is not a duplicate of itself, so fixing a
  // typo in one must not be rejected as already saved.
  const duplicate = findDuplicate(
    text,
    existing.filter((directive) => directive.id !== id)
  );
  if (duplicate) return { ok: false, reason: 'duplicate', existing: duplicate };

  const [row] = await db
    .update(assistantDirectives)
    .set({ text: parsed.data.text, source: 'user', updatedAt: new Date() })
    .where(and(eq(assistantDirectives.userId, userId), eq(assistantDirectives.id, id)))
    .returning();

  return row ? { ok: true, directive: toDirective(row) } : { ok: false, reason: 'not-found' };
}

/** Delete by id — what the settings screen uses, where the user picked the row. */
export async function deleteDirective(userId: string, id: string): Promise<Directive | null> {
  const [row] = await db
    .delete(assistantDirectives)
    .where(and(eq(assistantDirectives.userId, userId), eq(assistantDirectives.id, id)))
    .returning();

  return row ? toDirective(row) : null;
}

/**
 * Delete by description — what the model uses, since ids are not in its prompt.
 *
 * Ambiguity comes back as a question rather than a best guess. Dropping the
 * wrong standing rule is the one failure here nobody notices at the time.
 */
export async function forgetDirectiveByText(
  userId: string,
  text: string
): Promise<ForgetResult> {
  const existing = await listDirectives(userId);
  const match = matchDirective(normalizeDirective(text ?? ''), existing);

  if (match.kind === 'none') return { ok: false, reason: 'not-found' };
  if (match.kind === 'ambiguous') return { ok: false, reason: 'ambiguous', candidates: match.candidates };

  const removed = await deleteDirective(userId, match.directive.id);
  return removed ? { ok: true, directive: removed } : { ok: false, reason: 'not-found' };
}
