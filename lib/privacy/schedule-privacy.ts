export function looksLikeCalendarCommandOrScheduleOperation(text: string) {
  const t = text.toLowerCase();

  // UA/RU/EN command-like verbs + calendar words.
  const command =
    /(додай|добав|створи|создай|видали|удали|прибери|перенеси|перенести|зміни|измени|онови|update|delete|remove|cancel|create|add|move|reschedule)\b/i.test(
      text
    );
  const calendarish =
    /(поді(я|ю)|подия|ивент|event|calendar|календар|зустріч|встреч|meeting|занят(тя|ие)|урок|lesson|логопед|appointment|call)\b/i.test(
      text
    );
  const hasTimeOrDate =
    /(\b\d{1,2}:\d{2}\b)|(\b\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?\b)|(\b(today|tomorrow|tonight|saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b)|(\b(сьогодні|завтра|субот(а|у)|неділ(я|ю)|понеділок|вівторок|середа|четвер|п'ятниц(я|ю))\b)/i.test(
      text
    );

  // UI often includes a "schedule" label block; treat as operational schedule content.
  const scheduleLabelBlock =
    t.includes('\nschedule\n') ||
    t.startsWith('schedule\n') ||
    /\bschedule\b/i.test(text) ||
    /\bdecember\b|\bjanuary\b|\bfebruary\b|\bmarch\b|\bapril\b|\bmay\b|\bjune\b|\bjuly\b|\baugust\b|\bseptember\b|\boctober\b|\bnovember\b/i.test(
      text
    );

  return (command && calendarish) || (calendarish && hasTimeOrDate && command) || (scheduleLabelBlock && command);
}



