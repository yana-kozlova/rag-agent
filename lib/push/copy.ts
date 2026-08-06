/**
 * Every word a notification says, in both languages it can say it in.
 *
 * Notifications are the one surface the user cannot answer back on: a briefing
 * arrives, is read in three seconds, and is gone. That is why the wording lives
 * here as data rather than inline at each call site — the deterministic
 * fallbacks (used whenever the model is unavailable or the day is empty) have to
 * be as fluent as the generated copy, and the only way to keep them so is to
 * have both in front of you.
 *
 * The model is *asked* to write in the chosen language rather than translated
 * afterwards, so `writeIn` is part of the same table.
 */

export const NOTIFICATION_LOCALES = ['uk', 'en'] as const;

export type NotificationLocale = (typeof NOTIFICATION_LOCALES)[number];

/** The deployment's own language, used when a user has never chosen one. */
export const DEFAULT_LOCALE: NotificationLocale = 'uk';

export function isNotificationLocale(value: unknown): value is NotificationLocale {
  return NOTIFICATION_LOCALES.includes(value as NotificationLocale);
}

/** A stored value, coerced. An unknown or missing locale is the default one. */
export function resolveLocale(value: string | null | undefined): NotificationLocale {
  return isNotificationLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Ukrainian has three plural forms where English has two, and getting it wrong
 * is the loudest possible way to sound machine-generated ("4 подія").
 */
function pluralUk(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;

  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export type NotificationCopy = {
  /** BCP 47 tag for `Intl` — weekday names, and nothing else so far. */
  intlTag: string;
  /** Appended to every generation prompt. */
  writeIn: string;
  briefing: {
    morningTitle: string;
    thingsToday: (count: number) => string;
    nothingScheduled: string;
    more: (count: number) => string;
    allDay: string;
  };
  retro: {
    weekTitle: string;
    weekInReview: (hours: number) => string;
    events: (count: number) => string;
    scheduled: (hours: number) => string;
    busiest: (day: string) => string;
    notesSaved: (count: number) => string;
    quietWeek: string;
  };
  insight: {
    conflictTitle: string;
    conflictBody: (at: string, a: string, b: string, overlap: string) => string;
    noBreakTitle: string;
    noBreakBody: (duration: string, from: string, meetings: number) => string;
    personTitle: (name: string, at: string) => string;
  };
  /** "3 год 30 хв" / "3h 30m" — a duration as a person would say it. */
  duration: (minutes: number) => string;
};

const UK: NotificationCopy = {
  intlTag: 'uk-UA',
  writeIn: 'Write in Ukrainian.',
  briefing: {
    morningTitle: '☀️ Доброго ранку',
    thingsToday: (n) => `☀️ ${n} ${pluralUk(n, 'справа', 'справи', 'справ')} сьогодні`,
    nothingScheduled: 'На сьогодні нічого не заплановано — календар вільний.',
    more: (n) => `+ще ${n}`,
    allDay: 'увесь день',
  },
  retro: {
    weekTitle: '🗓️ Твій тиждень',
    weekInReview: (h) => `🗓️ Тиждень · ${h} год`,
    events: (n) => `${n} ${pluralUk(n, 'подія', 'події', 'подій')}`,
    scheduled: (h) => `${h} год у календарі`,
    busiest: (day) => `найщільніший — ${day}`,
    notesSaved: (n) => `${n} ${pluralUk(n, 'нотатка', 'нотатки', 'нотаток')}`,
    quietWeek: 'Тихий тиждень — нічого не заплановано й нічого не збережено.',
  },
  insight: {
    conflictTitle: '⚠️ Накладка',
    conflictBody: (at, a, b, overlap) =>
      `${at} — «${a}» і «${b}» перетинаються на ${overlap}`,
    noBreakTitle: '🌀 Без пауз',
    noBreakBody: (duration, from, meetings) =>
      `${duration} поспіль від ${from} — ${meetings} ${pluralUk(meetings, 'зустріч', 'зустрічі', 'зустрічей')} без перерви`,
    personTitle: (name, at) => `📝 ${name} о ${at}`,
  },
  duration: (minutes) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} хв`;
    return m === 0 ? `${h} год` : `${h} год ${m} хв`;
  },
};

const EN: NotificationCopy = {
  intlTag: 'en-GB',
  writeIn: 'Write in English.',
  briefing: {
    morningTitle: '☀️ Good morning',
    thingsToday: (n) => `☀️ ${n} ${n === 1 ? 'thing' : 'things'} today`,
    nothingScheduled: 'Nothing scheduled today. Your calendar is clear.',
    more: (n) => `+${n} more`,
    allDay: 'all day',
  },
  retro: {
    weekTitle: '🗓️ Your week',
    weekInReview: (h) => `🗓️ Week in review · ${h}h`,
    events: (n) => `${n} ${n === 1 ? 'event' : 'events'}`,
    scheduled: (h) => `${h}h scheduled`,
    busiest: (day) => `busiest ${day}`,
    notesSaved: (n) => `${n} ${n === 1 ? 'note' : 'notes'} saved`,
    quietWeek: 'A quiet week — nothing scheduled and nothing saved.',
  },
  insight: {
    conflictTitle: '⚠️ Double-booked',
    conflictBody: (at, a, b, overlap) =>
      `${at} — "${a}" and "${b}" overlap by ${overlap}`,
    noBreakTitle: '🌀 No gaps ahead',
    noBreakBody: (duration, from, meetings) =>
      `${duration} back-to-back from ${from} — ${meetings} meetings, no break`,
    personTitle: (name, at) => `📝 ${name} at ${at}`,
  },
  duration: (minutes) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  },
};

const COPY: Record<NotificationLocale, NotificationCopy> = { uk: UK, en: EN };

export function copyFor(locale: string | null | undefined): NotificationCopy {
  return COPY[resolveLocale(locale)];
}
