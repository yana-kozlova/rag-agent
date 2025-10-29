'use client';

import React from 'react';
import type { ChatPart } from '@/types/ai';

export function ToolOutput({ parts }: { parts: ChatPart[] }) {
  if (!Array.isArray(parts)) return null;
  const toolParts = parts.filter((p) => String(p?.type || '').startsWith('tool-')) as any[];
  if (toolParts.length === 0) return null;

  return (
    <div className="chat-footer opacity-80">
      {toolParts.map((part: any, idx: number) => {
        const isDone = part.state === 'output-available';
        return (
          <div key={`tool-${idx}`} className="mt-1">
            <span className="text-xs">
              {part.type} {isDone ? '(done)' : '(running)'}
            </span>
            {part.input && (
              <pre className="text-[10px] bg-base-200 p-2 rounded mt-1 overflow-x-auto max-w-[260px]">{JSON.stringify(part.input, null, 2)}</pre>
            )}
            {isDone && part.output && (
              <div className="mt-1">
                {typeof part.output === 'string' ? (
                  <pre className="text-[10px] bg-base-200 p-2 rounded overflow-x-auto max-w-[260px]">{part.output}</pre>
                ) : Array.isArray(part.output) ? (
                  <ul className="text-[11px] bg-base-200 p-2 rounded max-w-[260px] space-y-1">
                    {part.output.map((row: any, i: number) => (
                      <li key={`row-${i}`} className="break-words">{typeof row === 'string' ? row : JSON.stringify(row)}</li>
                    ))}
                  </ul>
                ) : (
                  <pre className="text-[10px] bg-base-200 p-2 rounded overflow-x-auto max-w-[260px]">{JSON.stringify(part.output, null, 2)}</pre>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


