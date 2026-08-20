'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, X } from 'lucide-react';

export type SuggestionView = {
  resourceId: string;
  resourceTitle: string;
  needKey: string;
  need: string;
  priority: 'high' | 'medium' | 'low' | null;
  context: string | null;
};

/**
 * Things the extractor read as needs, offered rather than filed.
 *
 * Extraction is liberal by design — it is the same liberality that puts a
 * greeting in the entity graph — so "хочу колись вивчити React" arrives here
 * looking exactly like "подати заяву до 17.08". Creating both as tasks would
 * fill the list faster than anyone empties it, which is why nothing lands
 * automatically and a dismissal is remembered for good.
 */
export default function Suggestions({ suggestions }: { suggestions: SuggestionView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function resolve(suggestion: SuggestionView, accept: boolean) {
    const key = `${suggestion.resourceId}::${suggestion.needKey}`;
    setBusy(key);

    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'suggestion',
          resourceId: suggestion.resourceId,
          needKey: suggestion.needKey,
          accept,
          input: accept
            ? {
                title: suggestion.need.slice(0, 200),
                priority: suggestion.priority ?? undefined,
                note: suggestion.context ?? undefined,
              }
            : undefined,
        }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2 rounded-lg border border-dashed border-base-300 p-4">
      <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
        Знайдено в нотатках <span className="opacity-60">({suggestions.length})</span>
      </h2>
      <p className="text-xs opacity-60">
        Це витягнуто з ваших нотаток, але ще не є завданнями. Відхилене більше не запропонують.
      </p>

      <ul className="divide-y divide-base-300">
        {suggestions.map((suggestion) => {
          const key = `${suggestion.resourceId}::${suggestion.needKey}`;
          return (
            <li key={key} className="flex items-start gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm">{suggestion.need}</p>
                <p className="mt-0.5 text-xs opacity-60">
                  з нотатки{' '}
                  <Link href={`/resources/${suggestion.resourceId}`} className="link">
                    {suggestion.resourceTitle}
                  </Link>
                </p>
              </div>

              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => resolve(suggestion, true)}
                  disabled={busy === key}
                  className="btn btn-ghost btn-xs btn-square"
                  aria-label="Зробити завданням"
                  title="Зробити завданням"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  onClick={() => resolve(suggestion, false)}
                  disabled={busy === key}
                  className="btn btn-ghost btn-xs btn-square"
                  aria-label="Це не завдання"
                  title="Це не завдання"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
