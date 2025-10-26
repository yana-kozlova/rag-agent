import { NextResponse } from 'next/server';
import { auth } from '../auth/auth';
import { GoogleCalendarService } from '@/lib/services/calendar';

export async function GET() {
  const session = await auth();
  
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const accessToken = session.user.accessToken;
    if (!accessToken) return new Response('Unauthorized', { status: 401 });
    const calendarService = new GoogleCalendarService(accessToken);
    const events = await calendarService.syncEvents();
    return NextResponse.json(events);
  } catch (error) {
    console.error('Failed to fetch calendar events:', error);
    return new Response('Failed to fetch calendar events', { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const eventData = await request.json();
    const accessToken = session.user.accessToken;
    if (!accessToken) return new Response('Unauthorized', { status: 401 });
    const calendarService = new GoogleCalendarService(accessToken);
    const event = await calendarService.createEvent('primary', eventData);
    return NextResponse.json(event);
  } catch (error) {
    console.error('Failed to create calendar event:', error);
    return new Response('Failed to create calendar event', { status: 500 });
  }
}
