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

  const [history, setHistory] = useState<{ id: string; role: string; content: string }[]>([]);
  const historyUi = history.map((h) => ({
    id: `hist-${h.id}`,
    role: h.role,
    parts: [{ type: 'text', text: h.content }],
  } as any));

  useEffect(() => {
    fetch('/api/chat/history')
      .then(r => r.json())
      .then(d => setHistory(Array.isArray(d.messages) ? d.messages : []))
      .catch(() => {});
  }, []);

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

  return (
    <section className="flex flex-col w-full max-w-sm py-24 mx-auto stretch">
      <div className="space-y-4">
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
