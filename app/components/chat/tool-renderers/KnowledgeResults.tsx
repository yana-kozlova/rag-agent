'use client';

import { useState } from 'react';
import { FileText, Table2, CalendarDays, Search } from 'lucide-react';
import { formatRelevance } from './formatting';

type Result = {
  content?: string;
  relevance?: number | null;
  rank?: number;
  source?: 'resource' | 'table' | 'calendar' | string;
  tableInfo?: { tableId?: string; tableTitle?: string } | null;
};

const SOURCE_ICON: Record<string, typeof FileText> = {
  resource: FileText,
  table: Table2,
  calendar: CalendarDays,
};

const COLLAPSED_CHARS = 180;

function Citation({ result }: { result: Result }) {
  const [expanded, setExpanded] = useState(false);
  const content = (result.content || '').trim();
  const long = content.length > COLLAPSED_CHARS;
  const shown = expanded || !long ? content : content.slice(0, COLLAPSED_CHARS).trimEnd() + '…';

  const Icon = SOURCE_ICON[result.source ?? ''] ?? FileText;
  const relevance = formatRelevance(result.relevance);
  const label = result.tableInfo?.tableTitle || result.source || 'note';

  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-2.5">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span className="text-[11px] uppercase font-semibold opacity-60 tracking-wide truncate">{label}</span>
        {relevance && (
          <span className="ml-auto flex items-center gap-1.5 shrink-0" title="Relevance">
            <span className="h-1 w-10 rounded-full bg-base-300 overflow-hidden">
              <span
                className="block h-full bg-success"
                style={{ width: `${Math.round((result.relevance as number) * 100)}%` }}
              />
            </span>
            <span className="font-mono text-[10px] opacity-60">{relevance}</span>
          </span>
        )}
      </div>
      <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">{shown}</p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] font-medium text-primary hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export function KnowledgeResults({ output }: { output: unknown }) {
  const results = Array.isArray(output) ? (output as Result[]) : [];
  // Guard: getInformation returns objects; a string[] here isn't ours to render.
  const usable = results.filter((r) => r && typeof r === 'object' && 'content' in r);

  if (usable.length === 0) {
    return (
      <div className="not-prose flex items-center gap-2 text-xs opacity-60">
        <Search className="h-3.5 w-3.5" />
        Nothing found in the knowledge base
      </div>
    );
  }

  return (
    <div className="not-prose max-w-sm space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase font-semibold opacity-50 tracking-wide">
        <Search className="h-3 w-3" />
        {usable.length} {usable.length === 1 ? 'source' : 'sources'}
      </div>
      {usable.map((r, i) => (
        <Citation key={i} result={r} />
      ))}
    </div>
  );
}
