'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { renderSimpleMarkdown } from '@/app/components/utils/markdown';
import { useAutoGreeting } from '@/app/components/chat/useAutoGreeting';
import { ToolOutput } from '@/app/components/chat/ToolOutput';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { getUserInitials } from '@/lib/utils';
import { isAutoGreetingText } from '@/lib/chat/auto-greeting';

type AttachedFile = {
  file: File;
  id: string;
  uploading?: boolean;
  resourceId?: string;
  error?: string;
};

export default function ChatSection() {
  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  

  type HistoryMessage = { id: string; role: string; content: string; createdAt?: string | Date };
  const [history, setHistory] = useState<HistoryMessage[]>([]);
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
  const historyRef = useRef(history);
  const loadingMoreRef = useRef(loadingMore);
  const autoGreetingHistory = history.map(h => ({ createdAt: h.createdAt, role: h.role as 'user' | 'assistant' | 'system' }));
  // Called for its side effect (fires the daily greeting); the prompt it sends
  // is hidden and never persisted, so its return value isn't needed here.
  useAutoGreeting({ history: autoGreetingHistory, historyLoaded, sendMessage });
  const topSentinelRef = useRef<HTMLDivElement | null>(null);

  const handleFiles = useCallback((files: File[]) => {
    const MAX_FILE_SIZE_MB = 10;
    const validFiles = files.filter((file) => {
      const maxSizeBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
      if (file.size > maxSizeBytes) {
        console.warn(`File ${file.name} exceeds ${MAX_FILE_SIZE_MB}MB limit`);
        return false;
      }
      const ext = file.name.split('.').pop()?.toLowerCase();
      const allowedExts = ['pdf', 'docx', 'txt', 'md'];
      if (!ext || !allowedExts.includes(ext)) {
        console.warn(`File ${file.name} has unsupported extension`);
        return false;
      }
      return true;
    });

    const newFiles: AttachedFile[] = validFiles.map((file) => ({
      file,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    }));

    setAttachedFiles((prev) => [...prev, ...newFiles]);
  }, []);

  // Keep refs in sync with state
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

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
    if (loadingMoreRef.current || !hasMore || historyRef.current.length === 0) return;
    try {
      setLoadingMore(true);
      const oldest = historyRef.current[0]?.createdAt;
      const oldestISO = typeof oldest === 'string' ? oldest : oldest instanceof Date ? oldest.toISOString() : '';
      const res = await fetch(`/api/chat/history?limit=15&before=${encodeURIComponent(oldestISO)}`);
      const data = await res.json();
      const arr: HistoryMessage[] = Array.isArray(data.messages) ? (data.messages as HistoryMessage[]) : [];
      
      // Deduplicate: filter out messages that already exist in history
      // Use functional update to get the latest state
      setHistory(prev => {
        const existingIds = new Set(prev.map(h => h.id));
        const newMessages = arr.filter((m: HistoryMessage) => !existingIds.has(m.id));
        
        if (newMessages.length > 0) {
          const el = listRef.current;
          const prevHeight = el ? el.scrollHeight : 0;
          const prevScroll = el ? el.scrollTop : 0;
          requestAnimationFrame(() => {
            if (el) {
              const newHeight = el.scrollHeight;
              el.scrollTop = newHeight - prevHeight + prevScroll;
            }
          });
          return [...newMessages, ...prev];
        }
        return prev;
      });
      
      // Set hasMore based on whether we got a full page (15 messages)
      // If we got 15 messages, there might be more pages, regardless of duplicates
      // Only set to false if we got fewer than 15 (meaning we've reached the end)
      setHasMore(arr.length === 15);
    } catch {}
    finally { setLoadingMore(false); }
  }, [hasMore]);

  useEffect(() => {
    const root = listRef.current;
    const sentinel = topSentinelRef.current;
    if (!root || !sentinel || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { 
        if (entry.isIntersecting && hasMore) {
          loadMore();
        }
      });
    }, { root, rootMargin: '100px', threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, hasMore]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <section className="flex flex-col w-full max-w-3xl mx-auto md:px-0">
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
          let bubbleText = textParts.map((p: any) => p.text).join('\n');
          
          // Remove hidden resourceIds marker from display (only for new messages, not from history)
          // Check if message is from useChat (not from history) by checking if it's in messagesWithUniqueIds
          const isFromUseChat = messagesWithUniqueIds.some((msg: any) => msg.id === m.id);
          if (isUser && isFromUseChat && bubbleText) {
            // Remove zero-width marker: [RESOURCE_IDS:...]
            bubbleText = bubbleText.replace(/\u200B\u200B\[RESOURCE_IDS:[^\]]+\]\u200B\u200B/g, '').trim();
          }
          
          
          // Hide the auto-greeting prompt: it's sent on the user's behalf, not
          // typed. Marker-tagged in this session, matched by signature for any
          // pre-marker greetings still sitting in history.
          const rawText = textParts.map((p: any) => p.text).join('\n');
          if (isUser && isAutoGreetingText(rawText)) return null;
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
            
            const timeStr = createdDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            
            if (messageDate.getTime() === today.getTime()) {
              // Today - show only time
              dateTimeStr = timeStr;
            } else if (messageDate.getTime() === yesterday.getTime()) {
              dateTimeStr = `yesterday, ${timeStr}`;
            } else {
              // Older - show full date and time
              const dateStr = createdDate.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
              dateTimeStr = `${dateStr} at ${timeStr}`;
            }
          }
          const userImage = session?.user?.image;
          const userName = session?.user?.name;
          const userInitials = getUserInitials(userName);

          return (
            <div key={m.id} className={`chat ${chatSide} max-w-full`}>
              <div className="chat-image avatar">
                {isUser ? (
                  userImage ? (
                    <div className="w-8 h-8 md:w-10 md:h-10 rounded-full overflow-hidden">
                      <Image alt="avatar" src={userImage} width={40} height={40} sizes="40px" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                  ) : (
                    <div className="avatar placeholder">
                      <div className="bg-neutral text-neutral-content w-8 h-8 md:w-10 md:h-10 rounded-full">
                        <span className="text-xs md:text-sm">{userInitials}</span>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-full overflow-hidden">
                    <Image alt="avatar" src="/avatars/bot.svg" width={40} height={40} sizes="40px" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
              <div className="chat-header">
                {isUser ? 'You' : 'Assistant'}
                {dateTimeStr && <time className="text-xs opacity-50 ml-2 font-mono">{dateTimeStr}</time>}
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

      {/* Attached files preview */}
      {attachedFiles.length > 0 && (
        <div className="mt-2 p-2 bg-base-200 rounded-lg space-y-2">
          {attachedFiles.map((attached) => (
            <div
              key={attached.id}
              className="flex items-center gap-2 p-2 bg-base-100 rounded border border-base-300"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="w-4 h-4 stroke-current text-primary">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{attached.file.name}</div>
                <div className="text-xs text-base-content/60">
                  {(attached.file.size / 1024).toFixed(1)} KB
                </div>
                {attached.uploading && (
                  <div className="flex items-center gap-1 text-xs text-primary mt-1">
                    <svg className="w-3 h-3 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Uploading...
                  </div>
                )}
                {attached.resourceId && (
                  <div className="text-xs text-success mt-1">✓ Saved</div>
                )}
                {attached.error && (
                  <div className="text-xs text-error mt-1">{attached.error}</div>
                )}
              </div>
              {!attached.uploading && (
                  <button
                  type="button"
                  onClick={() => {
                    setAttachedFiles((prev) => prev.filter((f) => f.id !== attached.id));
                  }}
                  className="btn btn-ghost btn-xs btn-circle"
                  aria-label="Remove file"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="w-4 h-4 stroke-current">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <form
        className="mt-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const content = input.trim();
          
          if (!content && attachedFiles.length === 0) return;

          // Upload files to resources (save for RAG)
          const uploadedResources: string[] = [];
          
          for (const attached of attachedFiles) {
            // Upload to resources if not already uploaded
            if (!attached.resourceId && !attached.uploading && !attached.error) {
              setAttachedFiles((prev) =>
                prev.map((f) => (f.id === attached.id ? { ...f, uploading: true } : f))
              );

              try {
                const uploadFormData = new FormData();
                uploadFormData.append('file', attached.file);
                if (content) {
                  uploadFormData.append('title', `${attached.file.name} - ${content.substring(0, 50)}`);
                }

                const uploadResponse = await fetch('/api/resources/upload', {
                  method: 'POST',
                  body: uploadFormData,
                });

                const uploadResult = await uploadResponse.json();
                if (uploadResult.ok && uploadResult.resourceId) {
                  uploadedResources.push(uploadResult.resourceId);
                  setAttachedFiles((prev) =>
                    prev.map((f) =>
                      f.id === attached.id ? { ...f, resourceId: uploadResult.resourceId, uploading: false } : f
                    )
                  );
                } else {
                  // Don't fail the whole message if upload fails, just log
                  console.warn('Failed to save file to resources:', uploadResult.message);
                  setAttachedFiles((prev) =>
                    prev.map((f) => (f.id === attached.id ? { ...f, uploading: false, error: uploadResult.message || 'Upload failed' } : f))
                  );
                }
              } catch (error) {
                // Don't fail the whole message if upload fails
                console.warn('Failed to save file to resources:', error);
                setAttachedFiles((prev) =>
                  prev.map((f) => (f.id === attached.id ? { ...f, uploading: false, error: error instanceof Error ? error.message : 'Upload failed' } : f))
                );
              }
            } else if (attached.resourceId) {
              uploadedResources.push(attached.resourceId);
            }
          }

          // Prepare message text for display (user-friendly, no technical info)
          let messageTextForDisplay = content;
          if (uploadedResources.length > 0 && !content) {
            messageTextForDisplay = `Uploaded ${uploadedResources.length} file(s)`;
          }

          if (messageTextForDisplay || uploadedResources.length > 0) {
           let messageToSend = messageTextForDisplay || '';
            if (uploadedResources.length > 0) {
              const marker = `\u200B\u200B[RESOURCE_IDS:${uploadedResources.join(',')}]\u200B\u200B`;
              messageToSend = messageTextForDisplay 
                ? `${messageTextForDisplay}${marker}`
                : `Uploaded ${uploadedResources.length} file(s)${marker}`;
            }
            
            sendMessage({ text: messageToSend });
          }

          setInput('');
          setAttachedFiles([]);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const files = Array.from(e.dataTransfer.files);
          handleFiles(files);
        }}
      >
        <div
          className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
            isDragging
              ? 'border-primary bg-primary/10'
              : 'border-base-300 bg-base-100'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.docx,.txt,.md"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              handleFiles(files);
              if (fileInputRef.current) {
                fileInputRef.current.value = '';
              }
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-outline"
            aria-label="Attach file"
            title="Attach file (PDF, DOCX, TXT, MD)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="w-5 h-5 stroke-current">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/>
            </svg>
          </button>
          <input
            className="input input-bordered flex-1"
            value={input}
            placeholder={isDragging ? 'Drop files here...' : 'Say something...'}
            onChange={(e) => setInput(e.currentTarget.value)}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!input.trim() && attachedFiles.length === 0}
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}

