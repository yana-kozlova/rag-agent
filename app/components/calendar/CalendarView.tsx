'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CalendarEvent } from './types';

export function EventListView() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/calendar');
      if (!response.ok) throw new Error('Failed to fetch events');
      const data = await response.json();
      
      const formattedEvents = data.map((event: any) => ({
        ...event,
        start: new Date(event.start),
        end: new Date(event.end),
      }));
      
      setEvents(formattedEvents);
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Events</h1>
      </div>

      <div className="space-y-4">
        {events.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No events found. Create your first event!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <div 
                key={event.id}
                className="border rounded-lg p-4 hover:bg-accent/50 transition-colors cursor-pointer"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium">{event.title}</h3>
                    {event.description && (
                      <p className="text-sm text-muted-foreground mt-1">{event.description}</p>
                    )}
                    {event.location && (
                      <p className="text-sm text-muted-foreground mt-1">📍 {event.location}</p>
                    )}
                    {event.attendees && event.attendees.length > 0 && (
                      <p className="text-sm text-muted-foreground mt-1">
                        👥 {event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-sm">
                    <div>
                      {format(new Date(event.start), 'MMM d, yyyy')}
                    </div>
                    <div className="text-muted-foreground">
                      {format(new Date(event.start), 'h:mm a')} - {format(new Date(event.end), 'h:mm a')}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}