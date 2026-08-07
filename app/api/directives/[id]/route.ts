import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/app/api/auth/auth';
import { deleteDirective, updateDirective } from '@/lib/actions/directives';
import { MAX_DIRECTIVE_LENGTH } from '@/lib/directives/directives';

export const runtime = 'nodejs';

const patchSchema = z.object({
  text: z.string().trim().min(1).max(MAX_DIRECTIVE_LENGTH),
});

/**
 * Rewrite a directive. Settings screen only — the chat repairs a rule by
 * dropping it and stating the new one, which is the same two sentences a user
 * would say anyway, and does not need the model resolving "change the third
 * one" against a list it cannot address by id.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: `A preference must be 1–${MAX_DIRECTIVE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const result = await updateDirective(userId, params.id, parsed.data.text);

    if (!result.ok) {
      if (result.reason === 'not-found') {
        return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
      }
      const message =
        result.reason === 'duplicate'
          ? `That duplicates “${result.existing?.text}”.`
          : `A preference must be 1–${MAX_DIRECTIVE_LENGTH} characters.`;
      return NextResponse.json({ ok: false, error: message }, { status: 409 });
    }

    return NextResponse.json({ ok: true, directive: result.directive });
  } catch (error: any) {
    console.error('[directives] PATCH error:', error);
    return NextResponse.json({ ok: false, error: error?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Scoped to the caller inside the query, not checked after the fact — this
    // is an id straight off the wire.
    const removed = await deleteDirective(userId, params.id);
    if (!removed) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, directive: removed });
  } catch (error: any) {
    console.error('[directives] DELETE error:', error);
    return NextResponse.json({ ok: false, error: error?.message ?? 'Unknown error' }, { status: 500 });
  }
}
