'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState } from 'react';
import { renderSimpleMarkdown } from '@/app/components/utils/markdown';
import { useAutoGreeting } from '@/app/components/chat/useAutoGreeting';
import { ToolOutput } from '@/app/components/chat/ToolOutput';
import type { ChatMessage } from '@/types/ai';

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
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const historyUi: ChatMessage[] = history.map((h) => ({
    id: `hist-${h.id}`,
    role: h.role,
    parts: [{ type: 'text', text: h.content }],
    createdAt: h.createdAt,
  } as any));

  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const autoGreetingHistory = history.map(h => ({ createdAt: h.createdAt, role: h.role as 'user' | 'assistant' | 'system' }));
  const autoPrompt = useAutoGreeting({ history: autoGreetingHistory, historyLoaded, sendMessage });
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
        setHistoryLoaded(true);
      })
      .catch(() => { setHistoryLoaded(true); });
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

  // auto greeting handled by hook above

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
        {[...historyUi, ...messages].filter((m:any) => m.role !== 'system').map((m) => {
          const isUser = m.role === 'user';
          const chatSide = isUser ? 'chat-end' : 'chat-start';
          const textParts = Array.isArray(m.parts) ? m.parts.filter((p: any) => p?.type === 'text') : [];
          const bubbleText = textParts.map((p: any) => p.text).join('\n');
          if (isUser && autoPrompt && bubbleText.trim() === autoPrompt.trim()) {
            return null;
          }
          const created = (m as any).createdAt;
          const timeStr = created ? new Date(created as any).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined;
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
              <ToolOutput parts={(m.parts as any) || []} />
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
