'use client';

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { SettingsSection } from './ui';

/**
 * The Google permission, and the one button that renews it.
 *
 * Being signed in and having Google access are two different things, and the
 * gap between them is measured in days: a session here is a JWT good for weeks,
 * while Google ends a refresh token after seven days for any OAuth client still
 * in "Testing" publishing status — and immediately if the user revokes it or
 * changes their password. So the app goes on working, the calendar quietly
 * stops, and "sign in again" is advice that cannot be followed, because a live
 * session means /signin bounces straight back to the dashboard.
 *
 * Hence a button that starts the Google flow outright rather than a link to the
 * sign-in page. `prompt: 'consent'` is already set on the provider, so this
 * always comes back with a fresh refresh token — which `persistGoogleAccount`
 * writes to the account row that cron and Telegram read.
 */

type Status = 'ok' | 'missing' | 'expired' | 'unavailable';

const LABEL: Record<Status, { badge: string; tone: string; line: string }> = {
  ok: {
    badge: 'Connected',
    tone: 'badge-success',
    line: 'Your calendar is readable right now.',
  },
  expired: {
    badge: 'Expired',
    tone: 'badge-error',
    line: 'Google has ended this permission. Reconnect to bring the calendar back.',
  },
  missing: {
    badge: 'Not granted',
    tone: 'badge-error',
    line: 'No Google permission is stored for this account yet.',
  },
  unavailable: {
    // Deliberately not phrased as the user's problem: this is Google not
    // answering, or this deployment's own credentials being wrong. Reconnecting
    // fixes neither, and saying otherwise sends someone through a consent
    // screen to repair an outage.
    badge: 'Unknown',
    tone: 'badge-ghost',
    line: 'Google did not answer, so this could not be checked. Try again in a few minutes.',
  },
};

export function GoogleAccessPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/api/google/status')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('unreachable'))))
      .then((data: { status: Status }) => setStatus(data.status))
      .catch(() => setFailed(true));
  }, []);

  const current = status ? LABEL[status] : null;

  return (
    <SettingsSection
      id="google"
      title="Google"
      description="The permission behind your calendar. Google grants it for a limited time and it has to be renewed."
      aside={
        current ? (
          <span className={`badge badge-sm ${current.tone}`}>{current.badge}</span>
        ) : null
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-base-content/60">
          {failed
            ? 'Could not check the permission from here.'
            : (current?.line ?? 'Checking…')}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-base-content/45">
            From your phone, send <span className="font-mono">/google</span> to the Telegram bot —
            it checks the same thing and links back here.
          </span>
          <button
            className={`btn btn-sm ${status && status !== 'ok' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => signIn('google', { callbackUrl: '/settings#google' })}
          >
            Reconnect Google
          </button>
        </div>
      </div>
    </SettingsSection>
  );
}
