# Push Notifications - Use Cases

This document describes various ways to use push notifications in your application.

## Current Features

### 1. Daily reminders at 9:00 AM
- **Endpoint**: `/api/push/scheduled` (called by cron)
- **Schedule**: `0 9 * * *` (daily at 9:00 UTC)
- **File**: `app/api/push/scheduled/route.ts`

### 2. Manual notification sending
- **Endpoint**: `POST /api/push/send`
- **Usage**: Send custom notifications to users
- **Example**:
```typescript
await fetch('/api/push/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Custom Notification',
    message: 'Your message here',
    data: { url: '/custom-page' }
  })
});
```

## New Features

### 3. Calendar event reminders ⏰

**File**: `app/api/push/event-reminders/route.ts`

Sends notifications 15 minutes before an event starts.

**Setup**:
1. Add cron job to `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/push/scheduled",
      "schedule": "0 9 * * *"
    },
    {
      "path": "/api/push/event-reminders",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

2. **Important**: You need to store OAuth refresh tokens to get access tokens. The code currently contains a placeholder - uncomment and implement token retrieval.

**Notification example**:
- "📅 Event starting soon: Meeting in 15 minutes at Conference Room"

### 4. Important information saved notifications 💾

**File**: `lib/push/helpers.ts` → `notifyImportantInfoSaved()`

Automatically sent when important information is saved to the knowledge base.

**Integration**: Already added to `lib/middleware/save-user-message.ts`

**Notification example**:
- "💾 Important info saved: Your information has been added to the knowledge base: 'Project deadline is next Friday...'"

### 5. Daily summary 📊

**File**: `lib/push/helpers.ts` → `notifyDailySummary()`

Sends a summary of events and activity for the day.

**Usage**:
```typescript
import { notifyDailySummary } from '@/lib/push/helpers';

await notifyDailySummary(userId, {
  eventsToday: 3,
  eventsUpcoming: 5,
  newResources: 2
});
```

**Notification example**:
- "📊 Daily Summary: Your day: 3 events today, 5 upcoming, 2 new resources"

## Utilities for working with notifications

### `notifyUser(userId, payload)`
Sends a notification to a specific user.

**Example**:
```typescript
import { notifyUser } from '@/lib/push/helpers';

await notifyUser(userId, {
  title: 'Custom Title',
  body: 'Your message',
  data: { url: '/', type: 'custom' },
  icon: '/avatars/bot.svg',
  tag: 'custom-notification'
});
```

## Cron job configuration

Add to `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/push/scheduled",
      "schedule": "0 9 * * *"
    },
    {
      "path": "/api/push/event-reminders",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

**Cron schedules**:
- `0 9 * * *` - daily at 9:00 UTC
- `*/5 * * * *` - every 5 minutes
- `0 */6 * * *` - every 6 hours
- `0 0 * * *` - daily at midnight

## Testing

To test notifications, use:
```typescript
// In API route or server action
import { notifyUser } from '@/lib/push/helpers';

await notifyUser(userId, {
  title: 'Test Notification',
  body: 'This is a test',
  data: { url: '/' }
});
```

Or via API:
```bash
curl -X POST http://localhost:3000/api/push/send \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", "message": "Hello"}'
```
