'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Somewhere to put a thought down without opening a conversation.
 *
 * Saving a note used to mean telling the chat, which costs a completion to
 * decide what the user already decided. Two ways in: typed, or written by hand.
 * The pad is behind a tab rather than always on the page — a canvas has to
 * swallow every touch to be written on, and one sitting open in the middle of
 * the dashboard stops a phone from scrolling past it.
 */

const InkPad = dynamic(() => import('@/app/components/ink/InkPad'), {
  ssr: false,
  loading: () => <div className="h-72 animate-pulse rounded-box bg-base-200 md:h-96" />,
});

type Mode = 'type' | 'draw';

const MODE_KEY = 'capture:mode';
const MAX_NOTE_LENGTH = 5000;

type Result = { tone: 'success' | 'error'; text: string; url?: string | null };

export default function Capture() {
  const [mode, setMode] = useState<Mode>('type');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // Whoever writes with a stylus writes with it every time.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(MODE_KEY) === 'draw') setMode('draw');
    } catch {
      /* default stands */
    }
  }, []);

  const choose = (next: Mode) => {
    setMode(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      /* not remembered, still switched */
    }
  };

  const save = async () => {
    const content = text.trim();
    if (!content || saving) return;

    setSaving(true);
    setResult(null);
    try {
      const res = await fetch('/api/resources/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setResult({ tone: 'error', text: data?.message || 'Could not save the note.' });
        return;
      }

      setText('');
      setResult({
        tone: 'success',
        text: data.merged ? data.message : 'Saved.',
        url: data.url,
      });
      window.dispatchEvent(new CustomEvent('dashboard:resources-changed'));
    } catch {
      setResult({ tone: 'error', text: 'Could not save the note.' });
    } finally {
      setSaving(false);
    }
  };

  const tab = (value: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => choose(value)}
      className={`rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${
        mode === value ? 'bg-base-200 text-base-content' : 'text-base-content/50 hover:text-base-content'
      }`}
    >
      {label}
    </button>
  );

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-base-content">Note</h2>
        <div role="tablist" className="flex items-center gap-1">
          {tab('type', 'Type')}
          {tab('draw', 'Write by hand')}
        </div>
      </div>

      {mode === 'draw' ? (
        <InkPad />
      ) : (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (result) setResult(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              }
            }}
            maxLength={MAX_NOTE_LENGTH}
            rows={3}
            placeholder="Something to remember…"
            className="textarea textarea-bordered w-full resize-y text-sm"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={!text.trim() || saving}
              className="btn btn-primary btn-sm"
            >
              {saving ? 'Saving…' : 'Save note'}
            </button>
            {result && (
              <span className={`min-w-0 truncate text-sm ${result.tone === 'error' ? 'text-error' : 'text-base-content/60'}`}>
                {result.text}
                {result.url && (
                  <>
                    {' '}
                    <Link href={result.url} className="font-medium text-primary hover:underline">
                      Open →
                    </Link>
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
