import { NextResponse } from 'next/server';

import { auth } from '@/app/api/auth/auth';
import {
  completeTask,
  createTask,
  deleteTask,
  getTasksView,
  listTaskSuggestions,
  reopenTask,
  resolveSuggestion,
  scheduleTask,
  unscheduleTask,
  updateTask,
} from '@/lib/actions/tasks';
import { taskInputSchema, taskPatchSchema } from '@/lib/db/schema/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The task list, read two ways: everything for the page, or just the pending
 * suggestions for the block that offers them. The widget uses the full view —
 * it needs the counts anyway, and bucketing a few hundred rows is cheaper than
 * a second round trip.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (new URL(req.url).searchParams.get('view') === 'suggestions') {
    return NextResponse.json({ suggestions: await listTaskSuggestions(session.user.id) });
  }

  return NextResponse.json(await getTasksView(session.user.id));
}

/** Adding a task by hand, from the form on the page. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const input = taskInputSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json(
      { error: input.error.issues[0]?.message ?? 'Invalid task' },
      { status: 400 }
    );
  }

  const result = await createTask({ userId: session.user.id, input: input.data });
  if (!result.success) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    task: result.task,
    duplicate: result.duplicate,
    calendarError: result.calendarError,
  });
}

/**
 * Every non-destructive change to a task: closing, reopening, scheduling,
 * unscheduling, editing, and resolving a suggestion. One route because they all
 * answer "the state of this task is now X" and the page refreshes the same way
 * after each.
 */
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { action?: string; id?: string; [k: string]: unknown }
    | null;

  if (!body?.action) {
    return NextResponse.json({ error: 'Missing action' }, { status: 400 });
  }

  const userId = session.user.id;

  // Suggestions are keyed by (resource, need) rather than by a task id, since
  // the task is what accepting one creates.
  if (body.action === 'suggestion') {
    const { resourceId, needKey, accept, input } = body as {
      resourceId?: string;
      needKey?: string;
      accept?: boolean;
      input?: unknown;
    };

    if (!resourceId || !needKey) {
      return NextResponse.json({ error: 'Missing suggestion' }, { status: 400 });
    }

    const parsed = accept ? taskInputSchema.safeParse(input) : null;
    if (accept && !parsed?.success) {
      return NextResponse.json({ error: 'Invalid task' }, { status: 400 });
    }

    const result = await resolveSuggestion({
      userId,
      resourceId,
      needKey,
      accept: Boolean(accept),
      input: parsed?.success ? parsed.data : undefined,
    });

    return NextResponse.json({ success: result.success, task: result.task });
  }

  if (!body.id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const taskId = body.id;

  switch (body.action) {
    case 'complete': {
      const result = await completeTask({ userId, taskId });
      return result.success
        ? NextResponse.json({ success: true, task: result.task, duplicate: result.duplicate })
        : NextResponse.json({ error: result.message }, { status: 404 });
    }

    case 'reopen': {
      const result = await reopenTask({ userId, taskId });
      return result.success
        ? NextResponse.json({ success: true, task: result.task })
        : NextResponse.json({ error: result.message }, { status: 404 });
    }

    case 'schedule': {
      const { day, startTime, endTime } = body as {
        day?: string;
        startTime?: string;
        endTime?: string;
      };
      if (!day) return NextResponse.json({ error: 'Missing day' }, { status: 400 });

      const result = await scheduleTask({ userId, taskId, day, startTime, endTime });
      return result.success
        ? NextResponse.json({
            success: true,
            task: result.task,
            calendarError: result.calendarError,
          })
        : NextResponse.json({ error: result.message }, { status: 404 });
    }

    case 'unschedule': {
      const result = await unscheduleTask({ userId, taskId });
      return result.success
        ? NextResponse.json({
            success: true,
            task: result.task,
            calendarError: result.calendarError,
          })
        : NextResponse.json({ error: result.message }, { status: 404 });
    }

    case 'edit': {
      // Not `taskInputSchema.partial()` — that would let an edit write
      // `scheduledFor` without the calendar event that is supposed to be it.
      const patch = taskPatchSchema.safeParse(body.patch);
      if (!patch.success) {
        return NextResponse.json({ error: 'Invalid patch' }, { status: 400 });
      }

      const result = await updateTask({ userId, taskId, patch: patch.data });
      return result.success
        ? NextResponse.json({ success: true, task: result.task })
        : NextResponse.json({ error: result.message }, { status: 404 });
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}

/**
 * Removing a task for good, and its calendar event with it.
 *
 * A route rather than a tool, on the wellbeing and timeline precedent: closing a
 * task is reversible and the model may do it, deleting is not and it may not.
 */
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const { success } = await deleteTask(session.user.id, id);
  return success
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: 'Not found' }, { status: 404 });
}
