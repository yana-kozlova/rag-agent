/**
 * Is this text an instruction to the calendar rather than a fact about the user?
 *
 * "Перенеси зустріч на вівторок" is an operation: the calendar tools carry it
 * out and then it is over. Filed in the knowledge base it becomes a fact that
 * never expires, surfacing in search months later as though the meeting were
 * still being moved. So `addResource` refuses these outright.
 *
 * ## Why the boundaries are written by hand
 *
 * These patterns used `\b`, which in JavaScript means "between a `\w` and a
 * non-`\w`" — and `\w` is `[A-Za-z0-9_]`, ASCII only. A Cyrillic letter is not
 * a word character to a JS regex, so `/додай\b/` never matched "додай ", and
 * every Ukrainian and Russian alternative here was dead: the rule only ever
 * fired on English. Adding the `u` flag does not fix it — `\w` stays ASCII —
 * so the boundary is spelled out with a Unicode property escape instead.
 */

/** A word boundary that knows about letters beyond ASCII. */
const AFTER = '(?![\\p{L}\\p{N}_])';
const BEFORE = '(?<![\\p{L}\\p{N}_])';

/** Wrap an alternation so it matches only as a whole word, in any script. */
function word(alternation: string): RegExp {
  return new RegExp(`${BEFORE}(?:${alternation})${AFTER}`, 'iu');
}

const COMMAND = word(
  'додай|добав|створи|создай|видали|удали|прибери|перенеси|перенести|зміни|измени|онови|' +
    'update|delete|remove|cancel|create|add|move|reschedule'
);

const CALENDARISH = word(
  'поді(?:я|ю)|подия|ивент|event|calendar|календар|зустріч|встреч|meeting|' +
    'занят(?:тя|ие)|урок|lesson|логопед|appointment|call'
);

/**
 * A day or a clock time. The apostrophe in "п'ятниця" is matched in both the
 * typewriter and typographic forms, because a phone keyboard produces the
 * second one and a laptop the first.
 */
const TIME_OR_DATE = new RegExp(
  [
    '\\b\\d{1,2}:\\d{2}\\b',
    '\\b\\d{1,2}[./-]\\d{1,2}(?:[./-]\\d{2,4})?\\b',
    `${BEFORE}(?:today|tomorrow|tonight|saturday|sunday|monday|tuesday|wednesday|thursday|friday)${AFTER}`,
    `${BEFORE}(?:сьогодні|завтра|субот(?:а|у)|неділ(?:я|ю)|понеділок|вівторок|середа|четвер|п['’]ятниц(?:я|ю))${AFTER}`,
  ].join('|'),
  'iu'
);

const MONTH = word(
  'january|february|march|april|may|june|july|august|september|october|november|december'
);

export function looksLikeCalendarCommandOrScheduleOperation(text: string) {
  const t = text.toLowerCase();

  const command = COMMAND.test(text);
  const calendarish = CALENDARISH.test(text);
  const hasTimeOrDate = TIME_OR_DATE.test(text);

  // The UI pastes a "schedule" label block; treat that as operational too.
  const scheduleLabelBlock =
    t.includes('\nschedule\n') ||
    t.startsWith('schedule\n') ||
    /\bschedule\b/i.test(text) ||
    MONTH.test(text);

  return (
    (command && calendarish) ||
    (calendarish && hasTimeOrDate && command) ||
    (scheduleLabelBlock && command && calendarish)
  );
}
