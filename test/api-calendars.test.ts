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
    select: () => ({
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

import { auth } from '@/app/api/auth/auth';
import { GET as GETCalendars, POST as POSTCalendars, DELETE as DELETECalendars } from '@/app/api/calendars/route';

describe('/api/calendars', () => {
  beforeEach(() => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'u1', accessToken: 'tok' } });
    memUser = { id: 'u1', followedCalendars: [] };
  });

  it('GET returns empty list initially', async () => {
    const res = await GETCalendars();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.calendars).toEqual([]);
  });

  it('GET returns 401 when unauthorized', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GETCalendars();
    expect(res.status).toBe(401);
  });

  it('POST adds a calendar', async () => {
    const req = new Request('http://localhost/api/calendars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarId: 'someone@example.com', summary: 'Work' }),
    });
    const res = await POSTCalendars(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.created).toBe(true);
    expect(memUser.followedCalendars).toHaveLength(1);
  });

  it('POST duplicate returns created:false', async () => {
    // seed
    memUser.followedCalendars = [{ calendarId: 'dup@example.com', summary: 'X' }];
    const req = new Request('http://localhost/api/calendars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarId: 'dup@example.com', summary: 'Y' }),
    });
    const res = await POSTCalendars(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.created).toBe(false);
    expect(memUser.followedCalendars).toHaveLength(1);
  });

  it('POST returns 401 when unauthorized', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new Request('http://localhost/api/calendars', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calendarId: 'x' }) });
    const res = await POSTCalendars(req);
    expect(res.status).toBe(401);
  });

  it('DELETE removes a calendar by id', async () => {
    // seed
    memUser.followedCalendars = [{ calendarId: 'someone@example.com', summary: 'Work' }];
    const req = new Request('http://localhost/api/calendars?calendarId=someone@example.com', {
      method: 'DELETE',
    });
    const res = await DELETECalendars(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(memUser.followedCalendars).toHaveLength(0);
  });

  it('DELETE non-existing is no-op', async () => {
    memUser.followedCalendars = [{ calendarId: 'a@example.com', summary: 'A' }];
    const req = new Request('http://localhost/api/calendars?calendarId=missing@example.com', { method: 'DELETE' });
    const res = await DELETECalendars(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(memUser.followedCalendars).toHaveLength(1);
  });

  it('DELETE returns 401 when unauthorized', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new Request('http://localhost/api/calendars?calendarId=x', { method: 'DELETE' });
    const res = await DELETECalendars(req);
    expect(res.status).toBe(401);
  });
});


