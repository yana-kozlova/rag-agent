import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GoogleCalendarService } from '@/lib/services/calendar';

const insert = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const del = vi.hoisted(() => vi.fn());

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} } },
    calendar: () => ({ events: { insert, patch, delete: del } }),
  },
}));

/** The request body the wrapper handed Google on the single call it made. */
const sentBody = (fn: typeof insert) => fn.mock.calls[0][0].requestBody;

const service = () => new GoogleCalendarService('token', 'user-1');

beforeEach(() => {
  vi.clearAllMocks();
  insert.mockResolvedValue({ data: { id: 'evt-1' } });
  patch.mockResolvedValue({ data: { id: 'evt-1' } });
  del.mockResolvedValue({});
});

describe('createEvent boundaries', () => {
  it('sends dateTime for a timed event and never mentions date', async () => {
    await service().createEvent('primary', {
      title: 'Прийом у педіатра',
      start: '2026-08-18T13:10:00+03:00',
      end: '2026-08-18T14:00:00+03:00',
    });

    const body = sentBody(insert);
    expect(body.start).toEqual({ dateTime: '2026-08-18T13:10:00+03:00' });
    expect(body.end).toEqual({ dateTime: '2026-08-18T14:00:00+03:00' });
    // On insert there is nothing to clear, and a null would just be noise.
    expect('date' in body.start).toBe(false);
  });

  it('sends date for an all-day event', async () => {
    await service().createEvent('primary', {
      title: 'Купити форму',
      // Google's end.date is exclusive: one day on the 18th ends on the 19th.
      start: { date: '2026-08-18' },
      end: { date: '2026-08-19' },
    });

    const body = sentBody(insert);
    expect(body.start).toEqual({ date: '2026-08-18' });
    expect(body.end).toEqual({ date: '2026-08-19' });
    expect('dateTime' in body.start).toBe(false);
  });

  it('accepts a Date and serialises it as an instant', async () => {
    await service().createEvent('primary', {
      title: 'x',
      start: new Date('2026-08-18T10:00:00Z'),
      end: new Date('2026-08-18T11:00:00Z'),
    });

    expect(sentBody(insert).start).toEqual({ dateTime: '2026-08-18T10:00:00.000Z' });
  });

  it('passes transparency through, and omits it when not asked', async () => {
    await service().createEvent('primary', {
      title: 'Купити форму',
      start: { date: '2026-08-18' },
      end: { date: '2026-08-19' },
      transparency: 'transparent',
    });
    expect(sentBody(insert).transparency).toBe('transparent');

    insert.mockClear();
    await service().createEvent('primary', {
      title: 'Нарада',
      start: '2026-08-18T10:00:00+03:00',
      end: '2026-08-18T11:00:00+03:00',
    });
    // Undefined, so Google applies its own default of "opaque".
    expect(sentBody(insert).transparency).toBeUndefined();
  });
});

describe('patchEvent conversions', () => {
  // This is the whole reason `clearOther` exists. Google keeps the field the
  // stored event already has unless it is explicitly overwritten, so a bare
  // dateTime patch onto an all-day event leaves `date` standing beside it.
  it('clears date when moving an all-day event to a time', async () => {
    await service().patchEvent('primary', 'evt-1', {
      start: '2026-08-19T09:00:00+03:00',
      end: '2026-08-19T09:30:00+03:00',
      transparency: 'opaque',
    });

    const body = sentBody(patch);
    expect(body.start).toEqual({ dateTime: '2026-08-19T09:00:00+03:00', date: null });
    expect(body.end).toEqual({ dateTime: '2026-08-19T09:30:00+03:00', date: null });
    expect(body.transparency).toBe('opaque');
  });

  it('clears dateTime when moving a timed event to a whole day', async () => {
    await service().patchEvent('primary', 'evt-1', {
      start: { date: '2026-08-20' },
      end: { date: '2026-08-21' },
      transparency: 'transparent',
    });

    const body = sentBody(patch);
    expect(body.start).toEqual({ date: '2026-08-20', dateTime: null });
    expect(body.end).toEqual({ date: '2026-08-21', dateTime: null });
  });

  it('leaves boundaries alone when the patch does not name them', async () => {
    await service().patchEvent('primary', 'evt-1', { title: 'нова назва' });

    const body = sentBody(patch);
    expect(body.start).toBeUndefined();
    expect(body.end).toBeUndefined();
  });
});

describe('deleteEvent on an event that is already gone', () => {
  // Without this, a user who deleted the event in Google could never unschedule
  // the task pointing at it: every attempt threw and the row kept a dead id.
  it.each([404, 410])('treats %i as success and says so', async (status) => {
    del.mockRejectedValueOnce(Object.assign(new Error('gone'), { status }));

    const result = await service().deleteEvent('primary', 'evt-1');
    expect(result).toEqual({ success: true, alreadyGone: true });
  });

  it('reads the status from response.status when that is where it lands', async () => {
    del.mockRejectedValueOnce(Object.assign(new Error('gone'), { response: { status: 410 } }));

    expect(await service().deleteEvent('primary', 'evt-1')).toEqual({
      success: true,
      alreadyGone: true,
    });
  });

  it('reports a real delete as not-already-gone', async () => {
    expect(await service().deleteEvent('primary', 'evt-1')).toEqual({
      success: true,
      alreadyGone: false,
    });
  });

  it('still throws on a failure that is not "not there"', async () => {
    del.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }));
    await expect(service().deleteEvent('primary', 'evt-1')).rejects.toThrow('forbidden');
  });

  it('does not mistake a string error code for a status', async () => {
    del.mockRejectedValueOnce(Object.assign(new Error('dns'), { code: 'ENOTFOUND' }));
    await expect(service().deleteEvent('primary', 'evt-1')).rejects.toThrow('dns');
  });
});
