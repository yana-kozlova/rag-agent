import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Returns the time of the next scheduled notification (9:00 AM daily)
 */
export async function GET() {
  const now = new Date();
  
  // Create date for today at 9:00 AM
  const nextDate = new Date(now);
  nextDate.setHours(9, 0, 0, 0);
  
  // If 9:00 AM has already passed today, schedule for tomorrow
  if (nextDate <= now) {
    nextDate.setDate(nextDate.getDate() + 1);
  }
  
  const millisecondsUntil = nextDate.getTime() - now.getTime();
  const minutesUntil = Math.ceil(millisecondsUntil / (1000 * 60));
  
  return NextResponse.json({
    nextScheduled: nextDate.toISOString(),
    nextScheduledLocal: nextDate.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }),
    minutesUntil,
    hoursUntil: Math.ceil(minutesUntil / 60),
  });
}

