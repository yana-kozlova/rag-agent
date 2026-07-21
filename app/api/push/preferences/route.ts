import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema/auth';
import { eq } from 'drizzle-orm';
import { getAccessTokenForUser, resolveUserTimezone } from '@/lib/push/google-token';
import { isValidTimezone } from '@/lib/push/timezone';

export const runtime = 'nodejs';

const hour = z.coerce.number().int().min(0).max(23);

const preferencesSchema = z
  .object({
    briefingEnabled: z.boolean().optional(),
    briefingHour: hour.optional(),
    eventRemindersEnabled: z.boolean().optional(),
    retroEnabled: z.boolean().optional(),
    retroHour: hour.optional(),
    // Explicit null clears the window; omitting the field leaves it untouched.
    quietHoursStart: hour.nullable().optional(),
    quietHoursEnd: hour.nullable().optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const rows = await db
      .select({
        briefingEnabled: users.briefingEnabled,
        briefingHour: users.briefingHour,
        eventRemindersEnabled: users.eventRemindersEnabled,
        retroEnabled: users.retroEnabled,
        retroHour: users.retroHour,
        quietHoursStart: users.quietHoursStart,
        quietHoursEnd: users.quietHoursEnd,
        timezone: users.timezone,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const prefs = rows[0];
    if (!prefs) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    }

    // Resolve lazily so the settings screen shows the zone that will actually
    // be used, rather than an empty field before the first cron run fills it.
    const timezone = prefs.timezone
      ? prefs.timezone
      : await resolveUserTimezone(userId, await getAccessTokenForUser(userId));

    return NextResponse.json({ ok: true, preferences: { ...prefs, timezone } });
  } catch (error: any) {
    console.error('[push/preferences] GET error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = preferencesSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid preferences' },
        { status: 400 }
      );
    }

    const input = parsed.data;

    if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
      return NextResponse.json(
        { ok: false, error: 'Unknown timezone' },
        { status: 400 }
      );
    }

    // A half-configured quiet window would silence unpredictably, so require
    // both ends to be present together.
    const startProvided = input.quietHoursStart !== undefined;
    const endProvided = input.quietHoursEnd !== undefined;
    if (startProvided !== endProvided) {
      return NextResponse.json(
        { ok: false, error: 'Quiet hours start and end must be set together' },
        { status: 400 }
      );
    }

    await db
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[push/preferences] PUT error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}
