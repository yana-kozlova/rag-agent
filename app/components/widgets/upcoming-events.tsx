import { db } from "@/lib/db";
import { resources } from "@/lib/db/schema/resources";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { auth } from "@/app/api/auth/auth";

export default async function UpcomingEvents() {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return (
        <section>
          <h2 className="text-xl font-semibold mb-3">Upcoming Events</h2>
          <p className="text-muted-foreground">Please sign in to view your upcoming events.</p>
        </section>
      );
    }
    // Select calendar resources with metadata and order by metadata.start
    const nowIso = new Date().toISOString();
    const rows = await db
      .select({
        id: resources.id,
        metadata: resources.metadata,
      })
      .from(resources)
      .where(
        and(
          eq(resources.source, 'calendar'),
          eq(resources.userId, userId),
          // metadata->>'start' > now
          gt(sql`((${resources.metadata})::jsonb->>'start')::timestamptz`, nowIso as unknown as any)
        )
      )
      .orderBy(asc(sql`((${resources.metadata})::jsonb->>'start')::timestamptz`));

    const events = rows
      .map(r => {
        const meta = (r.metadata as any) || {};
        const title = typeof meta.title === 'string' ? meta.title : undefined;
        const start = typeof meta.start === 'string' ? meta.start : undefined;
        const end = typeof meta.end === 'string' ? meta.end : undefined;
        const location = typeof meta.location === 'string' ? meta.location : undefined;
        return {
          id: r.id,
          title,
          start,
          end,
          location,
        };
      })
      .filter(e => e.title && e.start && e.end) as Array<{ id: string; title: string; start: string; end: string; location?: string }>;
    
    return (
        <section>
          <h2 className="text-xl font-semibold mb-3">Upcoming Events</h2>
          {events.length === 0 ? (
            <p className="text-muted-foreground">No events scheduled for nearest time.</p>
          ) : (
            <ul className="space-y-3">
              {events.map((ev) => (
                <li key={ev.id} className="border rounded-lg p-4">
                  <div className="font-medium">{ev.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {new Date(ev.start).toLocaleString()} – {new Date(ev.end).toLocaleString()}
                  </div>
                  {ev.location && (
                    <div className="text-sm text-muted-foreground">{ev.location}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
    );
}