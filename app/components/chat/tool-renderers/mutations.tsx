'use client';

import { CalendarX2, BookmarkCheck, Ban, Trash2, Info } from 'lucide-react';
import { ConfirmationCard } from './ConfirmationCard';

type Part = { input?: any; output?: any };

/** First non-empty line of a block of text, trimmed to a short preview. */
function firstLine(text?: string, max = 80): string | undefined {
  if (!text) return undefined;
  const line = text.split('\n').map((l) => l.trim()).find(Boolean);
  if (!line) return undefined;
  return line.length > max ? line.slice(0, max).trimEnd() + '…' : line;
}

export function renderDeleteEvent(part: Part) {
  const ok = part.output?.success !== false;
  return (
    <ConfirmationCard
      intent={ok ? 'success' : 'error'}
      icon={ok ? CalendarX2 : Ban}
      headline={ok ? 'Event removed' : 'Could not remove event'}
      detail={ok ? undefined : part.output?.message}
    />
  );
}

export function renderAddResource(part: Part) {
  const out = part.output ?? {};
  if (out.success === false) {
    // Privacy skips and other refusals — neutral, not an error the user caused.
    return <ConfirmationCard intent="neutral" icon={Info} headline="Not saved" detail={out.message} />;
  }
  const preview = part.input?.title || firstLine(part.input?.content);
  return (
    <ConfirmationCard
      intent="success"
      icon={BookmarkCheck}
      headline="Saved to knowledge base"
      detail={preview}
    />
  );
}

export function renderForgetInformation(part: Part) {
  const out = part.output ?? {};
  const count = typeof out.deletedCount === 'number' ? out.deletedCount : 0;

  if (out.success === false) {
    return <ConfirmationCard intent="error" icon={Ban} headline="Could not delete" detail={out.message} />;
  }
  if (count === 0) {
    return <ConfirmationCard intent="neutral" icon={Info} headline="Nothing to forget" detail={out.message} />;
  }

  const items = Array.isArray(out.deletedItems)
    ? out.deletedItems.map((it: any) => ({ primary: it.title || 'Untitled note', secondary: it.preview }))
    : undefined;

  return (
    <ConfirmationCard
      intent="success"
      icon={Trash2}
      headline={`Forgot ${count} ${count === 1 ? 'item' : 'items'}`}
      items={items}
    />
  );
}
