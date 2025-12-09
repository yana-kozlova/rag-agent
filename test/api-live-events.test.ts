import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/app/api/auth/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: {
  select: () => ({ from: (_t: any) => ({ where: (_e:any) => ({ limit: async (_n:number) => [{ id: 'u1', followedCalendars: [{ calendarId: 'cal1', summary: 'Work' }] }] }) }) }),
} }));
vi.mock('drizzle-orm', () => ({
  eq: (..._a:any[]) => ({}),
  sql: (_strings: TemplateStringsArray, ..._vals: any[]) => ({}),
}));
vi.mock('@/lib/db/schema', () => ({ users: {} }));

// Mock GoogleCalendarService class
vi.mock('@/lib/services/calendar', () => {
  class MockService {
    accessToken: string; userId: string;
    constructor(accessToken: string, userId: string){ this.accessToken = accessToken; this.userId = userId; }
    async fetchEvents(calendarId: string, _opts: any){
      const base = (id: string) => ({ id, summary: `Event-${id}`, start: { dateTime: '2025-10-29T08:00:00+02:00' }, end: { dateTime: '2025-10-29T09:00:00+02:00' } });
      if (calendarId === 'primary') return { items: [base('p1')] };
      if (calendarId === 'cal1') return { items: [base('c1')] };
      return { items: [] };
    }
  }
  return { GoogleCalendarService: MockService };
});

import { auth } from '@/app/api/auth/auth';
import { GET } from '@/app/api/calendar/live-events/route';

describe('/api/calendar/live-events', () => {
  beforeEach(() => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'u1', accessToken: 'tok' } });
  });

  it('returns 401 unauth when no session', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('aggregates events from primary and followed calendars', async () => {
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(json.events)).toBe(true);
    const ids = json.events.map((e: any) => e.id).sort();
    expect(ids).toEqual(['cal1:c1','primary:p1'].sort());
    // labels present
    const primary = json.events.find((e:any)=>e.id.startsWith('primary:'));
    const followed = json.events.find((e:any)=>e.id.startsWith('cal1:'));
    expect(primary.calendarLabel).toBe('primary');
    expect(followed.calendarLabel).toBeDefined();
  });
});


