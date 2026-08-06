'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NotificationLocale } from '@/lib/push/copy';

type Preferences = {
  briefingEnabled: boolean;
  briefingHour: number;
  proactiveEnabled: boolean;
  retroEnabled: boolean;
  retroHour: number;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string | null;
  locale: NotificationLocale;
};

/**
 * A label per language. Typed as a total record so that adding a locale to
 * `lib/push/copy.ts` fails the build here until it has a name to show — the
 * previous hand-kept array would silently have gone on offering two.
 */
const LOCALE_LABELS: Record<NotificationLocale, string> = {
  uk: 'Українська',
  en: 'English',
};

/** Where notifications go, and whether that route is actually open. */
type Delivery = { configured: boolean; linked: boolean };

/** When the next briefing lands, in the user's own zone. */
type NextRun = { nextScheduledLocal: string | null; timezone: string | null };

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const label = (h: number) => `${String(h).padStart(2, '0')}:00`;

export function NotificationPreferences() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [nextRun, setNextRun] = useState<NextRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/push/preferences');
      const data = await res.json();
      if (data.ok) {
        setPrefs(data.preferences);
        setError(null);
      } else {
        setError(data.error ?? 'Could not load preferences');
      }
    } catch {
      setError('Could not load preferences');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Read-only, and independent of the form, so a failure here leaves the
  // preferences below editable rather than blocking the whole panel. Linking
  // happens in another panel and cannot change under this one, so it is asked
  // once.
  useEffect(() => {
    fetch('/api/telegram/link')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) =>
        setDelivery(data ? { configured: !!data.configured, linked: !!data.linked } : null)
      )
      .catch(() => setDelivery(null));
  }, []);

  /**
   * When the next briefing actually lands, computed server-side from the stored
   * hour and the user's zone.
   *
   * Called after a save rather than from an effect on `prefs`: the form is
   * optimistic, so an effect would fire while the PUT was still in flight and
   * paint the *old* time next to the new hour — and then never correct itself.
   */
  const refreshNextRun = useCallback(async () => {
    try {
      const res = await fetch('/api/push/next-scheduled');
      const data = res.ok ? await res.json() : null;
      setNextRun(
        data?.enabled
          ? {
              nextScheduledLocal: data.nextScheduledLocal ?? null,
              timezone: data.timezone ?? null,
            }
          : null
      );
    } catch {
      setNextRun(null);
    }
  }, []);

  useEffect(() => {
    void refreshNextRun();
  }, [refreshNextRun]);

  // Optimistic: the control reflects the change immediately and rolls back only
  // if the server rejects it, so toggles never feel laggy.
  const save = async (patch: Partial<Preferences>) => {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, ...patch });
    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/push/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!data.ok) {
        setPrefs(previous);
        setError(data.error ?? 'Could not save');
      } else if (patch.briefingHour !== undefined || patch.briefingEnabled !== undefined) {
        await refreshNextRun();
      }
    } catch {
      setPrefs(previous);
      setError('Could not save');
    } finally {
      setSaving(false);
    }
  };

  const quietEnabled = prefs?.quietHoursStart != null && prefs?.quietHoursEnd != null;

  const toggleQuiet = (on: boolean) =>
    save(
      on
        ? { quietHoursStart: 22, quietHoursEnd: 8 }
        : { quietHoursStart: null, quietHoursEnd: null }
    );

  return (
    <section className="rounded-lg border border-base-300 bg-base-100 p-5">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Notifications</h2>
          {saving && <span className="loading loading-spinner loading-xs" />}
        </div>

        {/* Where these go. There is one channel now, and it either works or it
            doesn't — so this states the fact instead of offering a switch. */}
        {delivery && !delivery.configured ? (
          <div className="text-sm text-warning">
            No Telegram bot is configured on the server, so nothing can be delivered.
          </div>
        ) : delivery && !delivery.linked ? (
          <div className="text-sm text-warning">
            Notifications are delivered to Telegram, and this account has no chat linked
            yet. Link one in the Telegram panel below — until then, everything here is
            generated and discarded.
          </div>
        ) : (
          <div className="text-sm text-base-content/70">
            Delivered to your linked Telegram chat.
          </div>
        )}

        <div className="divider my-0" />

        {/* Account-level: which notifications to send and when. Independent of the
            toggle above — these persist even when this device has push off. */}
        {loading ? (
          <span className="loading loading-spinner loading-sm" />
        ) : !prefs ? (
          <div className="text-sm text-warning">{error ?? 'Unavailable'}</div>
        ) : (
          <>
            <div className="form-control">
              <label className="label cursor-pointer justify-between">
                <span className="label-text">Daily briefing</span>
                <input
                  type="checkbox"
                  className="toggle"
                  checked={prefs.briefingEnabled}
                  onChange={(e) => save({ briefingEnabled: e.currentTarget.checked })}
                />
              </label>
            </div>

            {prefs.briefingEnabled && (
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Send at</span>
                </label>
                <select
                  className="select select-bordered"
                  value={prefs.briefingHour}
                  onChange={(e) => save({ briefingHour: Number(e.currentTarget.value) })}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {label(h)}
                    </option>
                  ))}
                </select>
                <span className="label-text-alt mt-1 opacity-70">
                  Your local time{prefs.timezone ? ` — ${prefs.timezone}` : ''}
                </span>
                {nextRun?.nextScheduledLocal && (
                  <span className="label-text-alt mt-1 opacity-70">
                    Next: {nextRun.nextScheduledLocal}
                  </span>
                )}
              </div>
            )}

            <div className="form-control">
              <label className="label">
                <span className="label-text">Language</span>
              </label>
              <select
                className="select select-bordered"
                value={prefs.locale}
                onChange={(e) => save({ locale: e.currentTarget.value as NotificationLocale })}
              >
                {Object.entries(LOCALE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="label-text-alt mt-1 opacity-70">
                Applies to briefings, insights and the retrospective. This screen stays
                in English.
              </span>
            </div>

            <div className="form-control">
              <label className="label cursor-pointer justify-between">
                <span className="label-text">Proactive insights</span>
                <input
                  type="checkbox"
                  className="toggle"
                  checked={prefs.proactiveEnabled}
                  onChange={(e) => save({ proactiveEnabled: e.currentTarget.checked })}
                />
              </label>
              <span className="label-text-alt opacity-70">
                Nudges about double-bookings, long back-to-back stretches, and notes on
                people you&apos;re about to meet. These can arrive at times you didn&apos;t
                pick — quiet hours still apply.
              </span>
            </div>

            <div className="form-control">
              <label className="label cursor-pointer justify-between">
                <span className="label-text">Weekly retrospective</span>
                <input
                  type="checkbox"
                  className="toggle"
                  checked={prefs.retroEnabled}
                  onChange={(e) => save({ retroEnabled: e.currentTarget.checked })}
                />
              </label>
              <span className="label-text-alt opacity-70">
                A look back at where the week went, every Sunday.
              </span>
            </div>

            {prefs.retroEnabled && (
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Send on Sunday at</span>
                </label>
                <select
                  className="select select-bordered"
                  value={prefs.retroHour}
                  onChange={(e) => save({ retroHour: Number(e.currentTarget.value) })}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {label(h)}
                    </option>
                  ))}
                </select>
                <span className="label-text-alt mt-1 opacity-70">
                  Your local time{prefs.timezone ? ` — ${prefs.timezone}` : ''}
                </span>
              </div>
            )}

            <div className="form-control">
              <label className="label cursor-pointer justify-between">
                <span className="label-text">Quiet hours</span>
                <input
                  type="checkbox"
                  className="toggle"
                  checked={quietEnabled}
                  onChange={(e) => toggleQuiet(e.currentTarget.checked)}
                />
              </label>
            </div>

            {quietEnabled && (
              <div className="flex items-end gap-2">
                <div className="form-control flex-1">
                  <label className="label">
                    <span className="label-text">From</span>
                  </label>
                  <select
                    className="select select-bordered"
                    value={prefs.quietHoursStart ?? 22}
                    onChange={(e) =>
                      save({
                        quietHoursStart: Number(e.currentTarget.value),
                        quietHoursEnd: prefs.quietHoursEnd ?? 8,
                      })
                    }
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {label(h)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-control flex-1">
                  <label className="label">
                    <span className="label-text">To</span>
                  </label>
                  <select
                    className="select select-bordered"
                    value={prefs.quietHoursEnd ?? 8}
                    onChange={(e) =>
                      save({
                        quietHoursStart: prefs.quietHoursStart ?? 22,
                        quietHoursEnd: Number(e.currentTarget.value),
                      })
                    }
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {label(h)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {quietEnabled && (
              <span className="text-xs opacity-70">
                Proactive nudges stay silent during this window. A briefing or
                retrospective you scheduled inside it, and reminders you snoozed
                yourself, still come through.
              </span>
            )}

            {error && <div className="text-sm text-warning">{error}</div>}
          </>
        )}
      </div>
    </section>
  );
}
