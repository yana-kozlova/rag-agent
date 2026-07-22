'use client';

import { useCallback, useEffect, useState } from 'react';
import { NotificationsToggle } from '@/app/components/notifications/NotificationsToggle';

type Preferences = {
  briefingEnabled: boolean;
  briefingHour: number;
  proactiveEnabled: boolean;
  retroEnabled: boolean;
  retroHour: number;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string | null;
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const label = (h: number) => `${String(h).padStart(2, '0')}:00`;

export function NotificationPreferences() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
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
    <section className="card bg-base-100 shadow">
      <div className="card-body gap-4">
        <div className="flex items-center justify-between">
          <h2 className="card-title">Notifications</h2>
          {saving && <span className="loading loading-spinner loading-xs" />}
        </div>

        {/* Device-level: enable push on this browser, see status and next run. */}
        <NotificationsToggle />

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
              </div>
            )}

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
