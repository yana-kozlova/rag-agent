import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/app/api/auth/auth';
import { listDirectives, rememberDirective } from '@/lib/actions/directives';
import { MAX_DIRECTIVES, MAX_DIRECTIVE_LENGTH } from '@/lib/directives/directives';

export const runtime = 'nodejs';

const createSchema = z.object({
  text: z.string().trim().min(1).max(MAX_DIRECTIVE_LENGTH),
});

/**
 * The settings screen's view of what is in every prompt.
 *
 * A route rather than a tool, deliberately, and for the same reason wellbeing
 * rows are deleted through one: a standing instruction is followed silently on
 * every request, so the user has to be able to see the whole list and remove
 * from it without a model in the loop deciding what they meant.
 */
export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const directives = await listDirectives(userId);
    return NextResponse.json({ ok: true, directives, max: MAX_DIRECTIVES });
  } catch (error: any) {
    console.error('[directives] GET error:', error);
    return NextResponse.json({ ok: false, error: error?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: `A preference must be 1–${MAX_DIRECTIVE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    // Typed here, so always 'user' — an inferred one can only come from the tool.
    const result = await rememberDirective(userId, { text: parsed.data.text, source: 'user' });

    if (!result.ok) {
      const message =
        result.reason === 'duplicate'
          ? `Already saved as “${result.existing?.text}”.`
          : result.reason === 'full'
            ? `You already have ${MAX_DIRECTIVES} preferences. Remove one first.`
            : `A preference must be 1–${MAX_DIRECTIVE_LENGTH} characters.`;
      return NextResponse.json({ ok: false, error: message }, { status: 409 });
    }

    return NextResponse.json({ ok: true, directive: result.directive });
  } catch (error: any) {
    console.error('[directives] POST error:', error);
    return NextResponse.json({ ok: false, error: error?.message ?? 'Unknown error' }, { status: 500 });
  }
}
