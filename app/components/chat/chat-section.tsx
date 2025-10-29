'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState } from 'react';
import { renderSimpleMarkdown } from '@/app/components/utils/markdown';

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
        // fire-and-forget user facts extraction
        fetch('/api/chat/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: messageText })
        }).catch(() => {});
      }
    }
  });

  // Rely on onFinish to persist assistant messages when fully available

  const [history, setHistory] = useState<{ id: string; role: string; content: string; createdAt?: string | Date }[]>([]);
  const historyUi = history.map((h) => ({
    id: `hist-${h.id}`,
    role: h.role,
    parts: [{ type: 'text', text: h.content }],
    createdAt: h.createdAt,
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
    <section className="flex flex-col w-full max-w-3xl mx-auto px-4 md:px-0">
      <div
        ref={listRef}
        className="space-y-3 overflow-y-auto rounded-lg bg-base-100 p-3 max-w-full h-[480px] sm:h-[560px] md:h-[800px]"
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
        {[...historyUi, ...messages].map((m) => {
          const isUser = m.role === 'user';
          const chatSide = isUser ? 'chat-end' : 'chat-start';
          const textParts = Array.isArray(m.parts) ? m.parts.filter((p: any) => p?.type === 'text') : [];
          const bubbleText = textParts.map((p: any) => p.text).join('\n');
          const timeStr = m.createdAt ? new Date(m.createdAt as any).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined;
          const avatarSrc = isUser
            ? 'https://img.daisyui.com/images/profile/demo/anakeen@192.webp'
            : 'https://img.daisyui.com/images/profile/demo/kenobee@192.webp';
          return (
            <div key={m.id} className={`chat ${chatSide} max-w-full`}>
              <div className="chat-image avatar">
                <div className="w-8 md:w-10 rounded-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="avatar" src={avatarSrc} />
                </div>
              </div>
              <div className="chat-header">
                {isUser ? 'You' : 'Assistant'}
                {timeStr && <time className="text-xs opacity-50 ml-2">{timeStr}</time>}
              </div>
              {bubbleText && (
                <div className={`chat-bubble whitespace-pre-wrap break-words text-sm md:text-base`}>
                  {renderSimpleMarkdown(bubbleText)}
                </div>
              )}
              {/* Render any tool calls as compact blocks below bubble */}
              {Array.isArray(m.parts) && m.parts.some((p: any) => String(p?.type || '').startsWith('tool-')) && (
                <div className="chat-footer opacity-80">
                  {m.parts.map((part: any, idx: number) => {
                    if (!String(part?.type || '').startsWith('tool-')) return null;
                    const isDone = part.state === 'output-available';
                    return (
                      <div key={`tool-${idx}`} className="mt-1">
                        <span className="text-xs">
                          {part.type} {isDone ? '(done)' : '(running)'}
                        </span>
                        {/* Show input for transparency */}
                        {part.input && (
                          <pre className="text-[10px] bg-base-200 p-2 rounded mt-1 overflow-x-auto max-w-[260px]">{JSON.stringify(part.input, null, 2)}</pre>
                        )}
                        {/* Show output when ready */}
                        {isDone && part.output && (
                          <div className="mt-1">
                            {part.type === 'tool-getInformation' && Array.isArray(part.output) ? (
                              <ul className="text-[11px] bg-base-200 p-2 rounded max-w-[260px] space-y-1">
                                {part.output.map((row: any, i: number) => (
                                  <li key={`row-${i}`}>
                                    <div className="font-medium break-words">{row.content}</div>
                                    {row.metadata && (
                                      <div className="opacity-70 break-words">{typeof row.metadata === 'string' ? row.metadata : JSON.stringify(row.metadata)}</div>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <pre className="text-[10px] bg-base-200 p-2 rounded overflow-x-auto max-w-[260px]">{typeof part.output === 'string' ? part.output : JSON.stringify(part.output, null, 2)}</pre>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {loadingMore && (
          <div className="text-center text-xs text-neutral-500 py-2">Loading older messages…</div>
        )}
      </div>

      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          // persist user message then send
          const content = input;
          fetch('/api/chat/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content }) }).catch(() => {});
          sendMessage({ text: content });
          setInput('');
        }}
      >
        <div className="flex items-center gap-2">
          <input
            className="input input-bordered w-full"
            value={input}
            placeholder="Say something..."
            onChange={(e) => setInput(e.currentTarget.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
            Send
          </button>
        </div>
      </form>

    </section>
  );
}
