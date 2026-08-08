import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/app/api/auth/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: (..._args: any[]) => ({}),
}));

// In-memory stub user row
let memUser: any;

vi.mock('@/lib/db', () => ({
  db: {
    select: (_cols?: any) => ({
      from: (_tbl: any) => ({
        where: (_expr: any) => ({
          limit: async (_n: number) => [memUser].filter(Boolean),
        }),
      }),
    }),
    update: (_tbl: any) => ({
      set: (vals: any) => ({
        where: async (_expr: any) => {
          memUser = { ...(memUser || {}), ...vals };
        },
      }),
    }),
  },
}));

vi.mock('@/lib/db/schema', () => ({ users: {} }));

const listCalendars = vi.fn();
const getCalendar = vi.fn();

vi.mock('@/lib/services/calendar', () => ({
  GoogleCalendarService: class {
    listCalendars = listCalendars;
    getCalendar = getCalendar;
  },
}));

import { auth } from '@/app/api/auth/auth';
import {
  GET as GETCalendars,
  POST as POSTCalendars,
  DELETE as DELETECalendars,
} from '@/app/api/calendars/route';

const get = (url = 'http://localhost/api/calendars') => GETCalendars(new Request(url));

const post = (body: unknown) =>
  POSTCalendars(
    new Request('http://localhost/api/calendars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

/**
 * Following a calendar used to mean typing its id, and nothing checked the id.
 * These pin the two halves of the replacement: the list comes from Google, and
 * so does the name.
 */
describe('/api/calendars', () => {
  beforeEach(() => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', accessToken: 'tok' },
    });
    memUser = { id: 'u1', email: 'me@example.com', followedCalendars: [] };
    listCalendars.mockReset();
    getCalendar.mockReset();
  });

  it('lists the account calendars with what is followed marked on them', async () => {
    memUser.followedCalendars = [{ calendarId: 'work@example.com', summary: 'Work' }];
    listCalendars.mockResolvedValue([
      { id: 'me@example.com', summary: 'Me', description: null, primary: true, accessRole: 'owner', color: null },
      { id: 'work@example.com', summary: 'Work', description: null, primary: false, accessRole: 'reader', color: null },
      { id: 'holidays', summary: 'Holidays', description: null, primary: false, accessRole: 'reader', color: null },
    ]);

    const json = await (await get()).json();

    expect(json.calendars.map((c: any) => [c.id, c.followed])).toEqual([
      ['me@example.com', true],
      ['work@example.com', true],
      ['holidays', false],
    ]);
  });

  /**
   * An empty picker and an unreachable Google look identical and mean opposite
   * things, so the failure is reported rather than rendered as "no calendars".
   */
  it('reports a Google failure instead of answering with an empty list', async () => {
    listCalendars.mockRejectedValue(new Error('token expired'));

    const res = await get();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('google-unreachable');
  });

  it('answers from the database when asked for stored ids only', async () => {
    memUser.followedCalendars = [{ calendarId: 'work@example.com', summary: 'Work' }];

    const json = await (await get('http://localhost/api/calendars?stored=1')).json();

    expect(json.calendars).toEqual([
      { id: 'work@example.com', calendarId: 'work@example.com', summary: 'Work' },
    ]);
    expect(listCalendars).not.toHaveBeenCalled();
  });

  it('GET returns 401 when unauthorized', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  /** The stored name is Google's, not the one the caller sent. */
  it('verifies a calendar before storing it, and keeps Google’s name', async () => {
    getCalendar.mockResolvedValue({ id: 'someone@example.com', summary: 'Team calendar' });

    const json = await (await post({ calendarId: 'someone@example.com', summary: 'whatever' })).json();

    expect(json.created).toBe(true);
    expect(memUser.followedCalendars).toEqual([
      { calendarId: 'someone@example.com', summary: 'Team calendar' },
    ]);
  });

  /**
   * The regression this replaces: an id Google cannot read was stored happily
   * and then produced no events forever, because the fetch drops failing
   * calendars silently.
   */
  it('refuses an id it cannot read', async () => {
    getCalendar.mockResolvedValue(null);

    const res = await post({ calendarId: 'typo@example.com' });

    expect(res.status).toBe(404);
    expect(memUser.followedCalendars).toEqual([]);
  });

  /** Following your own calendar had it fetched twice on every read. */
  it('refuses the account’s own calendar', async () => {
    const res = await post({ calendarId: 'ME@example.com' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('primary');
    expect(getCalendar).not.toHaveBeenCalled();
  });

  it('POST duplicate returns created:false without asking Google', async () => {
    memUser.followedCalendars = [{ calendarId: 'dup@example.com', summary: 'X' }];

    const json = await (await post({ calendarId: 'dup@example.com' })).json();

    expect(json.created).toBe(false);
    expect(memUser.followedCalendars).toHaveLength(1);
    expect(getCalendar).not.toHaveBeenCalled();
  });

  it('POST returns 401 when unauthorized', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect((await post({ calendarId: 'x' })).status).toBe(401);
  });

  it('DELETE removes a calendar by id', async () => {
    memUser.followedCalendars = [{ calendarId: 'someone@example.com', summary: 'Work' }];
    const res = await DELETECalendars(
      new Request('http://localhost/api/calendars?calendarId=someone@example.com', {
        method: 'DELETE',
      })
    );

    expect(res.status).toBe(200);
    expect(memUser.followedCalendars).toHaveLength(0);
  });

  it('DELETE non-existing is a no-op', async () => {
    memUser.followedCalendars = [{ calendarId: 'a@example.com', summary: 'A' }];
    const res = await DELETECalendars(
      new Request('http://localhost/api/calendars?calendarId=missing@example.com', {
        method: 'DELETE',
      })
    );

    expect(res.status).toBe(200);
    expect(memUser.followedCalendars).toHaveLength(1);
  });
});
