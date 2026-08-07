'use client';

import { useEffect, useState } from 'react';
import { SettingsSection } from './ui';

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
    <SettingsSection
      id="telegram"
      title="Telegram"
      description="Chat with the same assistant from your phone, by text or voice — and where notifications are delivered."
      aside={
        status?.linked ? (
          <span className="badge badge-success badge-sm">Linked</span>
        ) : status && !status.configured ? (
          <span className="badge badge-ghost badge-sm">Unavailable</span>
        ) : status ? (
          <span className="badge badge-ghost badge-sm">Not linked</span>
        ) : null
      }
    >
      <div className="flex flex-col gap-3">
        {status && !status.configured && (
          <p className="text-sm text-base-content/60">
            No bot token is configured on the server yet.
          </p>
        )}

        {code ? (
          <>
            <label className="text-sm text-base-content/70" htmlFor="telegram-code">
              Send this to the bot — valid for 10 minutes.
            </label>
            <input
              id="telegram-code"
              className="input input-bordered input-sm font-mono text-sm"
              value={code.command}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
            />
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
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-base-content/60">
              {status?.linked ? `chat ${status.chatId}` : 'Not connected to a chat yet.'}
            </span>
            <button
              className="btn btn-outline btn-sm"
              onClick={generate}
              disabled={busy || (status ? !status.configured : false)}
            >
              {busy ? 'Generating…' : status?.linked ? 'Re-link' : 'Generate code'}
            </button>
          </div>
        )}

        {error && <div className="text-sm text-error">{error}</div>}
      </div>
    </SettingsSection>
  );
}
