'use client';

import { CalendarPlus, CalendarClock, AlertTriangle, CheckCircle2, ExternalLink, Ban } from 'lucide-react';
import { formatWhen } from './formatting';

type Conflict = { title?: string; start?: string; end?: string; calendarId?: string };
type Slot = { start?: string; end?: string };

type ScheduleOutput = {
  success?: boolean;
  message?: string;
  action?: 'created-new' | 'moved-existing' | 'would-create' | 'would-move';
  dryRun?: boolean;
  eventId?: string;
  htmlLink?: string;
  summary?: string;
  warning?: string;
  conflicts?: Conflict[];
  alternatives?: Slot[];
  candidates?: { title?: string; currentStart?: string; currentEnd?: string }[];
  desired?: { title?: string; start?: string; end?: string };
  moveTarget?: { title?: string; currentStart?: string; currentEnd?: string };
};

type Input = { title?: string; start?: string; end?: string };

function ConflictList({ conflicts }: { conflicts: Conflict[] }) {
  if (!conflicts?.length) return null;
  return (
    <div className="mt-2 space-y-1">
      {conflicts.map((c, i) => (
        <div key={i} className="flex items-baseline gap-2 text-xs">
          <span className="truncate">{c.title || 'Busy'}</span>
          <span className="font-mono opacity-60 shrink-0">{formatWhen(c.start, c.end)}</span>
        </div>
      ))}
    </div>
  );
}

function Alternatives({ slots }: { slots: Slot[] }) {
  if (!slots?.length) return null;
  return (
    <div className="mt-2">
      <div className="text-[11px] uppercase font-semibold opacity-50 mb-1">Free instead</div>
      <div className="flex flex-wrap gap-1">
        {slots.map((s, i) => (
          <span key={i} className="badge badge-outline badge-sm font-mono">{formatWhen(s.start, s.end)}</span>
        ))}
      </div>
    </div>
  );
}

export function ScheduleEventCard({ output, input }: { output: ScheduleOutput; input?: Input }) {
  // The desired time comes from the tool input where available (canonical),
  // falling back to whatever the output echoed back.
  const title = input?.title || output.desired?.title || output.moveTarget?.title || 'Event';
  const start = input?.start || output.desired?.start;
  const end = input?.end || output.desired?.end;
  const when = formatWhen(start, end);

  const blockedByConflict = output.success === false && !!output.conflicts?.length;
  const multiMatch = output.success === false && !!output.candidates?.length;
  const hasConflictWarning = output.success === true && !!output.warning;

  // Header intent: blocked, needs-choice, warned-but-done, or clean success.
  const intent = output.success === false ? 'error' : hasConflictWarning ? 'warning' : 'success';
  const moved = output.action === 'moved-existing' || output.action === 'would-move';
  const Icon = intent === 'error' ? (multiMatch ? Ban : AlertTriangle)
    : hasConflictWarning ? AlertTriangle
    : moved ? CalendarClock : CalendarPlus;

  const ring = intent === 'error' ? 'border-error/40' : intent === 'warning' ? 'border-warning/50' : 'border-success/40';
  const tint = intent === 'error' ? 'text-error' : intent === 'warning' ? 'text-warning' : 'text-success';

  const headline = blockedByConflict ? 'Time conflict — nothing scheduled'
    : multiMatch ? 'Multiple events match — pick one'
    : output.dryRun ? (moved ? 'Would move' : 'Would schedule')
    : moved ? 'Rescheduled' : 'Scheduled';

  return (
    <div className={`not-prose rounded-box border ${ring} bg-base-100 p-3 max-w-sm`}>
      <div className="flex items-start gap-2">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${tint}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <span className={tint}>{headline}</span>
            {output.success === true && !output.dryRun && <CheckCircle2 className="h-3 w-3 text-success" />}
          </div>
          <div className="font-medium text-sm truncate mt-0.5">{title}</div>
          {when && <div className="font-mono text-xs opacity-70">{when}</div>}
        </div>
      </div>

      {/* Multi-match: list candidate events the user must disambiguate. */}
      {multiMatch && (
        <div className="mt-2 space-y-1">
          {output.candidates!.map((c, i) => (
            <div key={i} className="flex items-baseline gap-2 text-xs">
              <span className="truncate">{c.title}</span>
              <span className="font-mono opacity-60 shrink-0">{formatWhen(c.currentStart, c.currentEnd)}</span>
            </div>
          ))}
        </div>
      )}

      {output.warning && <div className="mt-2 text-xs text-warning">{output.warning}</div>}

      {!!output.conflicts?.length && (
        <div className="mt-2">
          <div className="text-[11px] uppercase font-semibold opacity-50">
            {blockedByConflict ? 'Conflicts' : 'Overlaps'}
          </div>
          <ConflictList conflicts={output.conflicts} />
        </div>
      )}

      {!!output.alternatives?.length && <Alternatives slots={output.alternatives} />}

      {output.htmlLink && (
        <a
          href={output.htmlLink}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost btn-xs mt-2 px-1 gap-1 text-primary"
        >
          <ExternalLink className="h-3 w-3" /> Open in Calendar
        </a>
      )}
    </div>
  );
}
