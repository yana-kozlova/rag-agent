'use client';

import type { LucideIcon } from 'lucide-react';

export type ConfirmationIntent = 'success' | 'error' | 'neutral';

export type ConfirmationItem = { primary: string; secondary?: string };

const INTENT_STYLE: Record<ConfirmationIntent, { ring: string; tint: string }> = {
  success: { ring: 'border-success/40', tint: 'text-success' },
  error: { ring: 'border-error/40', tint: 'text-error' },
  neutral: { ring: 'border-base-300', tint: 'opacity-60' },
};

/**
 * A compact "we changed something" confirmation, shared by the mutation tools
 * (deleteEvent, addResource, forgetInformation). Each tool adapts its own
 * output to these props in the dispatcher — this component stays presentational.
 */
export function ConfirmationCard({
  intent,
  icon: Icon,
  headline,
  detail,
  items,
}: {
  intent: ConfirmationIntent;
  icon: LucideIcon;
  headline: string;
  detail?: string;
  items?: ConfirmationItem[];
}) {
  const { ring, tint } = INTENT_STYLE[intent];

  return (
    <div className={`not-prose rounded-box border ${ring} bg-base-100 p-3 max-w-sm`}>
      <div className="flex items-start gap-2">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${tint}`} />
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold ${intent === 'neutral' ? '' : tint}`}>{headline}</div>
          {detail && <div className="text-xs opacity-70 mt-0.5 break-words">{detail}</div>}
        </div>
      </div>

      {!!items?.length && (
        <ul className="mt-2 space-y-1">
          {items.map((item, i) => (
            <li key={i} className="border-l-2 border-base-300 pl-2">
              <div className="text-xs font-medium truncate">{item.primary}</div>
              {item.secondary && (
                <div className="text-[11px] opacity-55 break-words line-clamp-2">{item.secondary}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
