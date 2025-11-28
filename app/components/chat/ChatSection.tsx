'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { renderSimpleMarkdown } from '@/app/components/utils/markdown';
import { useAutoGreeting } from '@/app/components/chat/useAutoGreeting';
import { ToolOutput } from '@/app/components/chat/ToolOutput';
import { useSession } from 'next-auth/react';
import Image from 'next/image';

export default function ChatSection() {
  const [input, setInput] = useState('');
  const { data: session } = useSession();
  
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

  const [history, setHistory] = useState<{ id: string; role: string; content: string; createdAt?: string | Date }[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const historyUi = history.map((h) => ({
    id: `hist-${h.id}`,
    role: h.role,
    parts: [{ type: 'text', text: h.content }],
    createdAt: h.createdAt,
  } as any));
  
  // Deduplicate messages: if a message from useChat matches history by content and role, exclude it
  // Create a set of history message signatures (role + content) for fast lookup
  const historySignatures = new Set(
    historyUi.map((h: any) => {
      const textParts = Array.isArray(h.parts) ? h.parts.filter((p: any) => p?.type === 'text') : [];
      const content = textParts.map((p: any) => p.text).join('\n');
      return `${h.role}:${content}`;
    })
  );
  
  // Filter out messages that are already in history
  const messagesWithUniqueIds = messages
    .filter((m: any) => {
      const textParts = Array.isArray(m.parts) ? m.parts.filter((p: any) => p?.type === 'text') : [];
      const content = textParts.map((p: any) => p.text).join('\n');
      const signature = `${m.role}:${content}`;
      return !historySignatures.has(signature);
    })
    .map((m: any, idx: number) => ({
      ...m,
      id: `msg-${m.id || `temp-${idx}`}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    }));

  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const autoGreetingHistory = history.map(h => ({ createdAt: h.createdAt, role: h.role as 'user' | 'assistant' | 'system' }));
  const autoPrompt = useAutoGreeting({ history: autoGreetingHistory, historyLoaded, sendMessage });
  const topSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Defer history load to avoid blocking initial render/LCP
    const loadHistory = () => {
      fetch('/api/chat/history?limit=15')
        .then(r => r.json())
        .then(d => {
          const arr = Array.isArray(d.messages) ? d.messages : [];
          setHistory(arr);
          setHasMore(arr.length === 15);
          requestAnimationFrame(() => {
            const el = listRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          });
          setHistoryLoaded(true);
        })
        .catch(() => { setHistoryLoaded(true); });
    };
    
    // Use requestIdleCallback if available, otherwise setTimeout
    if ('requestIdleCallback' in window) {
      requestIdleCallback(loadHistory, { timeout: 1000 });
    } else {
      setTimeout(loadHistory, 100);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || history.length === 0) return;
    try {
      setLoadingMore(true);
      const oldest = history[0]?.createdAt;
      const oldestISO = typeof oldest === 'string' ? oldest : oldest instanceof Date ? oldest.toISOString() : '';
      const res = await fetch(`/api/chat/history?limit=15&before=${encodeURIComponent(oldestISO)}`);
      const data = await res.json();
      const arr = Array.isArray(data.messages) ? data.messages : [];
      
      // Deduplicate: filter out messages that already exist in history
      const existingIds = new Set(history.map(h => h.id));
      const newMessages = arr.filter(m => !existingIds.has(m.id));
      
      if (newMessages.length > 0) {
        const el = listRef.current;
        const prevHeight = el ? el.scrollHeight : 0;
        const prevScroll = el ? el.scrollTop : 0;
        setHistory(prev => [...newMessages, ...prev]);
        requestAnimationFrame(() => {
          if (el) {
            const newHeight = el.scrollHeight;
            el.scrollTop = newHeight - prevHeight + prevScroll;
          }
        });
        // Only set hasMore to true if we got the full limit (15) and there were new messages
        setHasMore(arr.length === 15 && newMessages.length > 0);
      } else {
        // No new messages means we've reached the end
        setHasMore(false);
      }
    } catch {}
    finally { setLoadingMore(false); }
  }, [loadingMore, hasMore, history]);

  useEffect(() => {
    const root = listRef.current;
    const sentinel = topSentinelRef.current;
    if (!root || !sentinel || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { 
        if (entry.isIntersecting && !loadingMore && hasMore) {
          loadMore();
        }
      });
    }, { root, rootMargin: '100px', threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, hasMore, loadingMore]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <section className="flex flex-col w-full max-w-3xl mx-auto px-4 md:px-0">
      <div
        ref={listRef}
        className="space-y-3 overflow-y-auto rounded-lg bg-base-100 p-3 max-w-full h-[480px] sm:h-[560px] md:h-[800px]"
        onScroll={(e) => { 
          if (e.currentTarget.scrollTop < 16 && !loadingMore && hasMore) {
            loadMore();
          }
        }}
      >
        <div ref={topSentinelRef} />
        {[...historyUi, ...messagesWithUniqueIds].filter((m:any) => m.role !== 'system').map((m) => {
          const isUser = m.role === 'user';
          const chatSide = isUser ? 'chat-end' : 'chat-start';
          const textParts = Array.isArray(m.parts) ? m.parts.filter((p: any) => p?.type === 'text') : [];
          const bubbleText = textParts.map((p: any) => p.text).join('\n');
          if (isUser && autoPrompt && bubbleText.trim() === autoPrompt.trim()) return null;
          const created = (m as any).createdAt;
          const createdDate = created ? new Date(created as any) : null;
          
          // Format date and time
          let dateTimeStr: string | undefined;
          if (createdDate) {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const messageDate = new Date(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate());
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            
            const timeStr = createdDate.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
            
            if (messageDate.getTime() === today.getTime()) {
              // Today - show only time
              dateTimeStr = timeStr;
            } else if (messageDate.getTime() === yesterday.getTime()) {
              dateTimeStr = `yesterday, ${timeStr}`;
            } else {
              // Older - show full date and time
              const dateStr = createdDate.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
              dateTimeStr = `${dateStr} о ${timeStr}`;
            }
          }
          const avatarSrc = isUser
            ? (session?.user?.image ?? '')
            : '/avatars/bot.svg';

          return (
            <div key={m.id} className={`chat ${chatSide} max-w-full`}>
              <div className="chat-image avatar">
                <div className="w-8 h-8 md:w-10 md:h-10 rounded-full overflow-hidden">
                  <Image alt="avatar" src={avatarSrc} width={40} height={40} sizes="40px" className="w-full h-full object-cover" />
                </div>
              </div>
              <div className="chat-header">
                {isUser ? 'You' : 'Assistant'}
                {dateTimeStr && <time className="text-xs opacity-50 ml-2">{dateTimeStr}</time>}
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
          const content = input;
          fetch('/api/chat/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content }) }).catch(() => {});
          // Saving to RAG is now handled automatically by middleware in /api/chat route
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

