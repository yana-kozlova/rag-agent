/**
 * What `getTimeline` hands the model to point at.
 *
 * The bug this pins: a date is stored twice — the row keeps the day, the note
 * keeps the wording — and the tool returned only the envelope's `/timeline`,
 * dropping the `resourceId` that was sitting on every row it had just selected.
 * Asked where the details were, the model had no address for the note it was
 * describing and wrote one that goes nowhere:
 * `https://your-link-to-the-resource/`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryTimelineEvents = vi.hoisted(() => vi.fn());
const upcomingTimeline = vi.hoisted(() => vi.fn());
const getSessionOrNull = vi.hoisted(() => vi.fn());

vi.mock('@/lib/actions/timeline', () => ({ queryTimelineEvents, upcomingTimeline }));
vi.mock('@/lib/utils/auth', () => ({ getSessionOrNull }));

import { getTimelineTool } from '@/lib/ai/tools/timeline/get-timeline';

const event = (over: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  title: 'День народження Ростіка',
  subject: 'Ростік',
  kind: 'birthday',
  note: 'Святкували в «Мануфактурі»',
  occurredOn: '2023-08-31',
  precision: 'day',
  recurrence: 'annual',
  resourceId: 'res-abc',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getSessionOrNull.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('getTimeline points at the note a date came from', () => {
  it('gives each event the address of its note', async () => {
    queryTimelineEvents.mockResolvedValue([event()]);

    const result: any = await getTimelineTool.execute({ year: '2023' });

    expect(result.events[0].url).toBe('/resources/res-abc');
  });

  it('returns null rather than a guess for a date typed straight onto the axis', async () => {
    queryTimelineEvents.mockResolvedValue([event({ resourceId: null })]);

    const result: any = await getTimelineTool.execute({ year: '2023' });

    expect(result.events[0].url).toBeNull();
  });

  it('carries the note address onto an upcoming occurrence too', async () => {
    upcomingTimeline.mockResolvedValue({
      today: '2026-08-28',
      occurrences: [{ date: '2026-08-31', daysAway: 3, years: 18, event: event() }],
    });

    const result: any = await getTimelineTool.execute({ upcomingDays: 7 });

    expect(result.upcoming[0].url).toBe('/resources/res-abc');
    // The page the axis itself lives on is still the envelope's answer.
    expect(result.url).toBe('/timeline');
  });
});
