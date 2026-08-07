'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NotificationLocale } from '@/lib/push/copy';
import { CONTROL_WIDTH, SettingsRow, SettingsRows, SettingsSection } from './ui';

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

  /**
   * The zone and the next firing, on one line.
   *
   * They used to be two stacked `label-text-alt` spans, which made a row about
   * a single dropdown three lines tall and pushed everything below it out of
   * rhythm with the rest of the page.
   */
  const timeHint = (withNextRun: boolean) =>
    [
      prefs?.timezone ? `Your local time — ${prefs.timezone}` : 'Your local time',
      withNextRun && nextRun?.nextScheduledLocal ? `next ${nextRun.nextScheduledLocal}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

  // Where these go. There is one channel now, and it either works or it doesn't
  // — so this states the fact instead of offering a switch.
  const undeliverable =
    delivery && !delivery.configured
      ? 'No Telegram bot is configured on the server, so nothing here can be delivered.'
      : delivery && !delivery.linked
        ? 'No Telegram chat is linked to this account yet. Link one below — until then, everything here is generated and discarded.'
        : null;

  return (
    <SettingsSection
      id="notifications"
      title="Notifications"
      description="Delivered to your linked Telegram chat."
      aside={saving ? <span className="loading loading-spinner loading-xs" /> : null}
    >
      {undeliverable && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-snug text-base-content/80">
          {undeliverable}
        </div>
      )}

      {loading ? (
        <span className="loading loading-spinner loading-sm" />
      ) : !prefs ? (
        <div className="text-sm text-warning">{error ?? 'Unavailable'}</div>
      ) : (
        <>
          <SettingsRows>
            <SettingsRow
              label="Daily briefing"
              description="What your day looks like, every morning."
              htmlFor="notif-briefing"
            >
              <input
                id="notif-briefing"
                type="checkbox"
                className="toggle"
                checked={prefs.briefingEnabled}
                onChange={(e) => save({ briefingEnabled: e.currentTarget.checked })}
              />
            </SettingsRow>

            {prefs.briefingEnabled && (
              <SettingsRow label="Send at" htmlFor="notif-briefing-hour" hint={timeHint(true)}>
                <select
                  id="notif-briefing-hour"
                  className={`select select-bordered select-sm ${CONTROL_WIDTH}`}
                  value={prefs.briefingHour}
                  onChange={(e) => save({ briefingHour: Number(e.currentTarget.value) })}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {label(h)}
                    </option>
                  ))}
                </select>
              </SettingsRow>
            )}

            <SettingsRow
              label="Proactive insights"
              description="Nudges about double-bookings, long back-to-back stretches, and notes on people you're about to meet. These can arrive at times you didn't pick — quiet hours still apply."
              htmlFor="notif-proactive"
            >
              <input
                id="notif-proactive"
                type="checkbox"
                className="toggle"
                checked={prefs.proactiveEnabled}
                onChange={(e) => save({ proactiveEnabled: e.currentTarget.checked })}
              />
            </SettingsRow>

            <SettingsRow
              label="Weekly retrospective"
              description="A look back at where the week went, every Sunday."
              htmlFor="notif-retro"
            >
              <input
                id="notif-retro"
                type="checkbox"
                className="toggle"
                checked={prefs.retroEnabled}
                onChange={(e) => save({ retroEnabled: e.currentTarget.checked })}
              />
            </SettingsRow>

            {prefs.retroEnabled && (
              <SettingsRow
                label="Send on Sunday at"
                htmlFor="notif-retro-hour"
                hint={timeHint(false)}
              >
                <select
                  id="notif-retro-hour"
                  className={`select select-bordered select-sm ${CONTROL_WIDTH}`}
                  value={prefs.retroHour}
                  onChange={(e) => save({ retroHour: Number(e.currentTarget.value) })}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {label(h)}
                    </option>
                  ))}
                </select>
              </SettingsRow>
            )}

            <SettingsRow
              label="Quiet hours"
              description={
                quietEnabled
                  ? 'Proactive nudges stay silent in this window. A briefing or retrospective you scheduled inside it, and reminders you snoozed yourself, still come through.'
                  : 'Hold proactive nudges overnight.'
              }
              htmlFor="notif-quiet"
            >
              <input
                id="notif-quiet"
                type="checkbox"
                className="toggle"
                checked={quietEnabled}
                onChange={(e) => toggleQuiet(e.currentTarget.checked)}
              />
            </SettingsRow>

            {quietEnabled && (
              <SettingsRow label="Silent between" htmlFor="notif-quiet-from">
                <div className="flex items-center gap-2">
                  <select
                    id="notif-quiet-from"
                    aria-label="Quiet hours start"
                    className="select select-bordered select-sm w-full sm:w-20"
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
                  <span className="text-xs text-base-content/50">and</span>
                  <select
                    aria-label="Quiet hours end"
                    className="select select-bordered select-sm w-full sm:w-20"
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
              </SettingsRow>
            )}

            <SettingsRow
              label="Language"
              description="Applies to briefings, insights and the retrospective. This screen stays in English."
              htmlFor="notif-locale"
            >
              <select
                id="notif-locale"
                className={`select select-bordered select-sm ${CONTROL_WIDTH}`}
                value={prefs.locale}
                onChange={(e) => save({ locale: e.currentTarget.value as NotificationLocale })}
              >
                {Object.entries(LOCALE_LABELS).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </SettingsRow>
          </SettingsRows>

          {error && <div className="mt-4 text-sm text-warning">{error}</div>}
        </>
      )}
    </SettingsSection>
  );
}
