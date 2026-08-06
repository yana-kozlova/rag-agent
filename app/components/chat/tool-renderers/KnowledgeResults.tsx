'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileText, Table2, Search, ArrowUpRight } from 'lucide-react';
import { formatRelevance } from './formatting';

type Result = {
  content?: string;
  relevance?: number | null;
  rank?: number;
  source?: 'resource' | 'table' | string;
  /** Unified id of whatever was matched — the note or the table row. */
  sourceId?: string | null;
  tableInfo?: { tableId?: string; tableTitle?: string } | null;
};

/**
 * Where a citation leads, or null when it leads nowhere.
 *
 * A quoted fragment invites you to check the source, so the ones we can open —
 * notes and tables — become links. Anything else stays plain text: there is no
 * page of ours to land on.
 */
function hrefFor(result: Result): string | null {
  if (result.source === 'resource' && result.sourceId) return `/resources/${result.sourceId}`;
  if (result.source === 'table' && result.tableInfo?.tableId) {
    return `/tables/${result.tableInfo.tableId}`;
  }
  return null;
}

const SOURCE_ICON: Record<string, typeof FileText> = {
  resource: FileText,
  table: Table2,
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
  const href = hrefFor(result);

  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-2.5">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
        {href ? (
          <Link
            href={href}
            className="group flex min-w-0 items-center gap-1 text-[11px] uppercase font-semibold tracking-wide opacity-60 transition-colors hover:text-primary hover:opacity-100"
          >
            <span className="truncate">{label}</span>
            <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        ) : (
          <span className="text-[11px] uppercase font-semibold opacity-60 tracking-wide truncate">{label}</span>
        )}
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
