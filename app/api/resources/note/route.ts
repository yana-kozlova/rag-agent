import { NextResponse } from 'next/server';

import { auth } from '@/app/api/auth/auth';
import { addResourceTool } from '@/lib/ai/tools/information/add-resource';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** A typed note, not a pasted document — those go through the upload route. */
const MAX_NOTE_LENGTH = 5000;

/**
 * Save a note typed straight onto the dashboard.
 *
 * Runs the same code the chat's `addResource` tool does rather than calling
 * `createResource` directly: that is where extraction, the privacy rule and the
 * routing into an existing dossier live, and a second door that skipped them
 * would write a second note about a person who already has one — the
 * duplication the routing exists to prevent. What this saves over the chat is
 * the completion deciding *whether* to save; here the user already said so.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { content?: unknown } | null;
  const content = typeof body?.content === 'string' ? body.content.trim() : '';

  if (!content) {
    return NextResponse.json({ ok: false, message: 'Nothing to save' }, { status: 400 });
  }
  if (content.length > MAX_NOTE_LENGTH) {
    return NextResponse.json(
      { ok: false, message: `A note is at most ${MAX_NOTE_LENGTH} characters. Upload longer text as a file.` },
      { status: 400 }
    );
  }

  try {
    const result = (await addResourceTool.execute({ content })) as {
      success?: boolean;
      id?: string;
      url?: string;
      merged?: boolean;
      message?: string;
    };

    if (!result?.success) {
      return NextResponse.json(
        { ok: false, message: result?.message || 'Could not save the note' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      id: result.id ?? null,
      url: result.url ?? null,
      merged: Boolean(result.merged),
      message: result.message ?? 'Saved',
    });
  } catch (error) {
    console.error('POST /api/resources/note error', error);
    return NextResponse.json({ ok: false, message: 'Could not save the note' }, { status: 500 });
  }
}
