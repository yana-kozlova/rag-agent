'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState } from 'react';

export default function ChatSection() {
  const [input, setInput] = useState('');
  const { messages, sendMessage } = useChat({
    onFinish: async (message: any) => {
      const messageText = message.message?.parts?.find((p: any) => p?.type === 'text')?.text;
      if (messageText) {
        await fetch('/api/chat/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', content: messageText })
        });
      }
    }
  });

  // Rely on onFinish to persist assistant messages when fully available

  const [history, setHistory] = useState<{ id: string; role: string; content: string; createdAt?: string | Date }[]>([]);
  const historyUi = history.map((h) => ({
    id: `hist-${h.id}`,
    role: h.role,
    parts: [{ type: 'text', text: h.content }],
  } as any));

  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/chat/history?limit=15')
      .then(r => r.json())
      .then(d => {
        const arr = Array.isArray(d.messages) ? d.messages : [];
        setHistory(arr);
        setHasMore(arr.length === 15);
        // scroll to bottom on initial load
        requestAnimationFrame(() => {
          const el = listRef.current;
          if (el) {
            el.scrollTop = el.scrollHeight;
          }
        });
      })
      .catch(() => {});
  }, []);

  const loadMore = async () => {
    if (loadingMore || !hasMore || history.length === 0) return;
    try {
      setLoadingMore(true);
      const oldest = history[0]?.createdAt;
      const oldestISO = typeof oldest === 'string' ? oldest : oldest instanceof Date ? oldest.toISOString() : '';
      const res = await fetch(`/api/chat/history?limit=15&before=${encodeURIComponent(oldestISO)}`);
      const data = await res.json();
      const arr = Array.isArray(data.messages) ? data.messages : [];
      if (arr.length > 0) {
        const el = listRef.current;
        const prevHeight = el ? el.scrollHeight : 0;
        const prevScroll = el ? el.scrollTop : 0;
        setHistory(prev => [...arr, ...prev]);
        // maintain scroll position after prepending
        requestAnimationFrame(() => {
          if (el) {
            const newHeight = el.scrollHeight;
            el.scrollTop = newHeight - prevHeight + prevScroll;
          }
        });
      }
      setHasMore(arr.length === 15);
    } catch {}
    finally { setLoadingMore(false); }
  };

  // IntersectionObserver to load when top sentinel becomes visible
  useEffect(() => {
    const root = listRef.current;
    const sentinel = topSentinelRef.current;
    if (!root || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            loadMore();
          }
        });
      },
      { root, rootMargin: '0px', threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [listRef.current, topSentinelRef.current, hasMore, loadingMore, history.length]);

  useEffect(() => {
    try {
      const key = 'chatStartupPingAt';
      const params = new URLSearchParams(window.location.search);
      const force = params.get('autoping') === '1';
      const last = window.localStorage.getItem(key);
      const now = Date.now();
      const twelveHoursMs = 12 * 60 * 60 * 1000;
      const shouldPing = force || !last || (now - parseInt(last, 10)) > twelveHoursMs;
      if (shouldPing && (force || Math.random() < 0.3)) {
        setTimeout(() => {
          sendMessage({ text: 'Quick check-in: summarize my agenda for today in two lines.' });
          window.localStorage.setItem(key, String(Date.now()));
        }, 200);
      }
    } catch {}
  }, [sendMessage]);

  // auto-scroll to bottom on new live messages unless user scrolled up
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  return (
    <section className="flex flex-col w-full max-w-sm py-24 mx-auto stretch">
      <div
        ref={listRef}
        className="space-y-4 h-[70vh] overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          // load older when near top
          if (el.scrollTop < 16) {
            loadMore();
          }
        }}
      >
        {/* top sentinel for intersection-based loading */}
        <div ref={topSentinelRef} />
        {hasMore && !loadingMore && (
          <button
            type="button"
            className="btn btn-xs btn-outline mx-auto block"
            onClick={loadMore}
          >
            Load older
          </button>
        )}
        {[...historyUi, ...messages].map((m) => (
          <div key={m.id} className="whitespace-pre-wrap">
            <div>
              <div className="font-bold">{m.role}</div>
              {m.parts.map((part: any, idx: number) => {
                switch (part.type) {
                  case 'text':
                    return <p key={`text-${idx}`}>{part.text}</p>;
                  case 'tool-addResource':
                  case 'tool-getInformation':
                    return (
                      <p key={`tool-${idx}`}>
                        call{part.state === 'output-available' ? 'ed' : 'ing'} tool: {part.type}
                        <pre className="my-4 bg-zinc-100 p-2 rounded-sm">{JSON.stringify(part.input, null, 2)}</pre>
                      </p>
                    );
                  default:
                    return null;
                }
              })}
            </div>
          </div>
        ))}
        {loadingMore && (
          <div className="text-center text-xs text-neutral-500 py-2">Loading older messages…</div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          // persist user message then send
          const content = input;
          fetch('/api/chat/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content }) }).catch(() => {});
          sendMessage({ text: content });
          setInput('');
        }}
      >
        <input
          className="fixed bottom-0 w-full max-w-md p-2 mb-8 input input-bordered"
          value={input}
          placeholder="Say something..."
          onChange={(e) => setInput(e.currentTarget.value)}
        />
      </form>

    </section>
  );
}
