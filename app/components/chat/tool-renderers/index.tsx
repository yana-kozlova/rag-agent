'use client';

import { ScheduleEventCard } from './ScheduleEventCard';
import { KnowledgeResults } from './KnowledgeResults';
import { RawToolOutput } from './RawToolOutput';

type ToolPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
};

/** Tool name → dedicated card. Anything not listed uses the raw fallback. */
const RENDERERS: Record<string, (part: ToolPart) => React.ReactNode> = {
  scheduleEvent: (part) => (
    <ScheduleEventCard output={(part.output ?? {}) as any} input={part.input as any} />
  ),
  getInformation: (part) => <KnowledgeResults output={part.output} />,
};

export function renderToolPart(part: ToolPart): React.ReactNode {
  const toolName = String(part.type || '').replace(/^tool-/, '');
  const done = part.state === 'output-available';

  // Rich cards need output; until it arrives, show the shared running state.
  const renderer = RENDERERS[toolName];
  if (renderer && done) return renderer(part);

  return <RawToolOutput toolName={toolName} state={part.state} output={part.output} />;
}
