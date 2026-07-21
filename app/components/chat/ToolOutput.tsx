'use client';

import type { ChatPart } from '@/types/ai';
import { renderToolPart } from './tool-renderers';

export function ToolOutput({ parts }: { parts: ChatPart[] }) {
  if (!Array.isArray(parts)) return null;
  const toolParts = parts.filter((p) => String(p?.type || '').startsWith('tool-')) as any[];
  if (toolParts.length === 0) return null;

  return (
    <div className="chat-footer mt-1.5 space-y-2">
      {toolParts.map((part, idx) => (
        <div key={`tool-${idx}`}>{renderToolPart(part)}</div>
      ))}
    </div>
  );
}
