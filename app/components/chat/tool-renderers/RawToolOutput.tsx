'use client';

import { Loader2, Wrench } from 'lucide-react';

// Human labels for tools that don't (yet) have a dedicated card. Everything
// falls back to a de-prefixed tool name if it isn't listed here.
const TOOL_LABELS: Record<string, string> = {
  getEvents: 'Checked the calendar',
  deleteEvent: 'Removed an event',
  optimizeSchedule: 'Optimised the schedule',
  addResource: 'Saved to knowledge base',
  forgetInformation: 'Removed from knowledge base',
  analyzeFile: 'Analysed a file',
  createTable: 'Created a table',
  listTables: 'Listed tables',
  getTableRows: 'Read a table',
  addTableRows: 'Added table rows',
  extractToTable: 'Extracted to a table',
  createQuickAction: 'Created a button',
  deleteQuickAction: 'Removed a button',
  addTask: 'Saved a task',
  getTasks: 'Checked the task list',
  completeTask: 'Closed a task',
  scheduleTask: 'Scheduled a task',
  logWellbeing: 'Logged how you feel',
  getWellbeing: 'Read the wellbeing tracker',
  rememberDate: 'Saved a date',
  getTimeline: 'Read the timeline',
  rememberPreference: 'Saved a preference',
  forgetPreference: 'Removed a preference',
};

function labelFor(toolName: string) {
  return TOOL_LABELS[toolName] ?? toolName.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** Renders a string[] output (e.g. getEvents) as a readable list, not JSON. */
function StringList({ items }: { items: string[] }) {
  if (items.length === 0) return <div className="text-xs opacity-60">No results</div>;
  return (
    <ul className="space-y-1">
      {items.map((s, i) => (
        <li key={i} className="text-xs break-words border-l-2 border-base-300 pl-2">{s}</li>
      ))}
    </ul>
  );
}

export function RawToolOutput({
  toolName,
  state,
  output,
}: {
  toolName: string;
  state?: string;
  output?: unknown;
}) {
  const label = labelFor(toolName);
  const running = state !== 'output-available';

  if (running) {
    return (
      <div className="not-prose flex items-center gap-1.5 text-xs opacity-60">
        <Loader2 className="h-3 w-3 animate-spin" />
        {label}…
      </div>
    );
  }

  const isStringArray = Array.isArray(output) && output.every((x) => typeof x === 'string');
  const body = isStringArray ? (
    <StringList items={output as string[]} />
  ) : typeof output === 'string' ? (
    <p className="text-xs whitespace-pre-wrap break-words">{output}</p>
  ) : (
    <pre className="text-[10px] overflow-x-auto">{JSON.stringify(output, null, 2)}</pre>
  );

  return (
    <details className="not-prose group max-w-sm">
      <summary className="flex items-center gap-1.5 text-xs opacity-70 cursor-pointer list-none marker:content-none">
        <Wrench className="h-3 w-3" />
        <span>{label}</span>
        <span className="opacity-40 group-open:rotate-90 transition-transform">›</span>
      </summary>
      <div className="mt-1.5 rounded-box bg-base-200 p-2">{body}</div>
    </details>
  );
}
