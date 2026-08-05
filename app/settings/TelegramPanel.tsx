'use client';

import { useEffect, useState } from 'react';

type Status = { configured: boolean; linked: boolean; chatId: string | null };
type Code = { code: string; command: string; deepLink: string | null; expiresAt: string };

/**
 * The authenticated half of Telegram linking.
 *
 * The bot can only learn who a chat belongs to if a signed-in session vouches
 * for it, so the code is always minted here and carried to the bot by hand.
 */
export function TelegramPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState<Code | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/telegram/link')
      .then((res) => (res.ok ? res.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/telegram/link', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text().catch(() => 'Request failed'));
      setCode(await res.json());
    } catch {
      setError('Could not generate a code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-base-300 bg-base-100 p-5">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">Telegram</h2>
          <p className="mt-1 text-sm text-base-content/60">
            Chat with the same assistant from your phone, by text or voice.
          </p>
        </div>

        {status && !status.configured && (
          <div className="text-sm text-base-content/60">
            No bot token is configured on the server yet.
          </div>
        )}

        {status?.linked && !code && (
          <div className="text-sm">
            <span className="badge badge-success badge-sm mr-2">Linked</span>
            <span className="text-base-content/60">chat {status.chatId}</span>
          </div>
        )}

        {code ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-base-content/70">
                Send this to the bot (valid for 10 minutes)
              </label>
              <input
                className="input input-bordered font-mono text-sm"
                value={code.command}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
            {code.deepLink && (
              <a
                href={code.deepLink}
                target="_blank"
                rel="noreferrer"
                className="btn btn-primary btn-sm self-start"
              >
                Open in Telegram
              </a>
            )}
          </div>
        ) : (
          <button
            className="btn btn-outline btn-sm self-start"
            onClick={generate}
            disabled={busy || (status ? !status.configured : false)}
          >
            {busy ? 'Generating…' : status?.linked ? 'Re-link' : 'Generate code'}
          </button>
        )}

        {error && <div className="text-sm text-error">{error}</div>}
      </div>
    </section>
  );
}
