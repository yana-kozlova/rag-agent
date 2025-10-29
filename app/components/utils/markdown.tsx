import React from 'react';

// Lightweight markdown renderer for headings (###), lists (- ) and **bold** inline.
export function renderSimpleMarkdown(text: string): JSX.Element {
  const lines = text.split(/\n+/);
  const nodes: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const renderInline = (s: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return (
      <>
        {parts.map((p, i) => {
          if (p.startsWith('**') && p.endsWith('**')) {
            return <strong key={`b-${i}`}>{p.slice(2, -2)}</strong>;
          }
          return <span key={`t-${i}`}>{p}</span>;
        })}
      </>
    );
  };

  const flushList = () => {
    if (listBuffer.length > 0) {
      nodes.push(
        <ul key={`ul-${nodes.length}`} className="list-disc ml-5 space-y-1">
          {listBuffer.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };

  lines.forEach((l) => {
    if (l.startsWith('### ')) {
      flushList();
      nodes.push(
        <div key={`h3-${nodes.length}`} className="font-semibold mt-2">
          {l.replace(/^###\s+/, '')}
        </div>
      );
      return;
    }
    if (l.startsWith('- ')) {
      listBuffer.push(l.slice(2));
      return;
    }
    flushList();
    if (l.trim().length > 0) {
      nodes.push(
        <p key={`p-${nodes.length}`} className="mt-1">
          {renderInline(l)}
        </p>
      );
    }
  });
  flushList();
  return <div className="space-y-1">{nodes}</div>;
}


