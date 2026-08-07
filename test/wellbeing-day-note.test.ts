import { describe, expect, it } from 'vitest';

import { dayNoteContent, type DayNoteEntry } from '@/lib/wellbeing/day-note';

type Entry = DayNoteEntry;

function entry(partial: Partial<Entry> & { recordedAt: string }): Entry {
  return {
    localDate: '2026-08-07',
    mood: null,
    energy: null,
    sleepMinutes: null,
    symptoms: [],
    note: null,
    ...partial,
    recordedAt: new Date(partial.recordedAt),
  };
}

const TZ = 'Europe/Kyiv';

describe('dayNoteContent', () => {
  it('gathers a day into one note instead of one note per check-in', () => {
    const content = dayNoteContent(
      [
        entry({
          recordedAt: '2026-08-07T00:45:00Z',
          mood: 3,
          energy: 2,
          note: 'Сьогодні лягла дуже пізно.',
        }),
        entry({
          recordedAt: '2026-08-07T06:32:00Z',
          symptoms: ['нудота'],
          note: 'зранку нудота',
        }),
      ],
      TZ
    );

    expect(content).toBe(
      [
        '[2026-08-07]',
        '',
        '03:45 · mood 3/5 · energy 2/5',
        'Сьогодні лягла дуже пізно.',
        '',
        '09:32 · нудота',
        'зранку нудота',
      ].join('\n')
    );
  });

  it('renders times in the user\'s zone, not the server\'s', () => {
    const kyiv = dayNoteContent([entry({ recordedAt: '2026-08-07T06:32:00Z' })], TZ);
    const utc = dayNoteContent([entry({ recordedAt: '2026-08-07T06:32:00Z' })], 'UTC');

    expect(kyiv).toContain('09:32');
    expect(utc).toContain('06:32');
  });

  it('keeps the user\'s own words even when nothing was measured', () => {
    const content = dayNoteContent(
      [entry({ recordedAt: '2026-08-07T06:32:00Z', note: 'просто втомилась' })],
      TZ
    );

    expect(content).toContain('просто втомилась');
    expect(content).toContain('09:32');
  });

  it('carries sleep and symptoms into the heading', () => {
    const content = dayNoteContent(
      [
        entry({
          recordedAt: '2026-08-07T06:32:00Z',
          sleepMinutes: 390,
          symptoms: ['головний біль', 'нудота'],
          note: 'кепсько',
        }),
      ],
      TZ
    );

    expect(content).toContain('sleep 6h 30m · головний біль, нудота');
  });

  it('rebuilds cleanly when a check-in is removed', () => {
    const all = [
      entry({ recordedAt: '2026-08-07T00:45:00Z', mood: 3, note: 'пізно лягла' }),
      entry({ recordedAt: '2026-08-07T06:32:00Z', mood: 2, note: 'нудить' }),
    ];

    const after = dayNoteContent([all[0]], TZ);

    expect(after).toContain('пізно лягла');
    expect(after).not.toContain('нудить');
  });
});
