import { redirect } from 'next/navigation';

import { auth } from '@/app/api/auth/auth';
import { getTasksView, listTaskSuggestions } from '@/lib/actions/tasks';
import { daysLate } from '@/lib/tasks/tasks';
import AddTaskForm from './AddTaskForm';
import Suggestions, { type SuggestionView } from './Suggestions';
import TaskList, { type TaskView } from './TaskList';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Everything outstanding, in the four groups that mean different things.
 *
 * The whole list is on one page on purpose. The user asked for exactly this —
 * "я хочу бачити весь список, а не тільки 20 справ на сьогодні" — because a task
 * with a deadline a fortnight out is one you want to see while there is still a
 * choice of days to do it on. A page that shows only today is a page that can
 * only ever tell you what is already urgent.
 */
export default async function TasksPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/api/auth/signin');

  const [view, suggestions] = await Promise.all([
    getTasksView(session.user.id),
    // Degrades on its own: a failure here costs the offers, never the list.
    listTaskSuggestions(session.user.id).catch(() => [] as SuggestionView[]),
  ]);

  const toView = (task: Awaited<ReturnType<typeof getTasksView>>['buckets']['overdue'][number]): TaskView => ({
    id: task.id,
    title: task.title,
    note: task.note,
    dueOn: task.dueOn,
    scheduledFor: task.scheduledFor,
    scheduledStart: task.scheduledStart,
    priority: task.priority,
    area: task.area,
    recurrence: task.recurrence,
    daysLate: daysLate(task.dueOn, view.today),
    hasEvent: Boolean(task.googleEventId),
  });

  const groups = [
    { key: 'overdue', label: 'Прострочені', tasks: view.buckets.overdue.map(toView) },
    { key: 'today', label: 'Заплановано на сьогодні', tasks: view.buckets.today.map(toView) },
    { key: 'upcoming', label: 'Найближчі дедлайни', tasks: view.buckets.upcoming.map(toView) },
    { key: 'someday', label: 'Без дати', tasks: view.buckets.someday.map(toView) },
  ].filter((g) => g.tasks.length > 0);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Завдання</h1>
        <p className="text-sm opacity-70">
          {view.counts.open === 0
            ? 'Нічого не висить.'
            : `${view.counts.open} відкритих${view.counts.overdue > 0 ? `, ${view.counts.overdue} прострочено` : ''}`}
        </p>
      </header>

      <AddTaskForm />

      {suggestions.length > 0 && <Suggestions suggestions={suggestions} />}

      {groups.length === 0 ? (
        <p className="rounded-lg border border-base-300 p-6 text-center text-sm opacity-70">
          Поки порожньо. Скажіть асистенту «треба купити форму до 31.08» — або додайте вручну вище.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <TaskList key={group.key} label={group.label} tasks={group.tasks} today={view.today} />
          ))}
        </div>
      )}
    </div>
  );
}
