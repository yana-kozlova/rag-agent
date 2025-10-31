# AI SDK RAG

## Table of Contents
1. [Project Overview](#project-overview)
2. [Requirements](#requirements)
3. [Technology Stack](#technology-stack)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [Usage](#usage)
7. [Running Tests](#running-tests)
8. [Deployment](#deployment)
9. [API Documentation](#api-documentation)

## Project Overview
A Next.js (App Router) application showcasing a chat assistant powered by the Vercel AI SDK with tools, Google Calendar integration, and a modern UI using Tailwind + DaisyUI. Key features:
- Chat with streaming answers, tool calling, and message history persisted to Postgres (with progressive loading and an auto-greeting).
- Google Calendar integration: fetch live events across primary and followed calendars; create events via a tool.
- Followed calendars stored directly on the user record (`user.followed_calendars` jsonb) with a settings panel to add/remove.
- Calendar widgets: Today summary, Upcoming events (grouped by day, per-calendar badges), and an Events Quick Panel (week strip, filters, featured event with countdown).
- Theming with DaisyUI (custom themes: silk, bumblebee, autumn) and a dropdown theme switcher.
- Authentication via NextAuth (Google OAuth); sessions used for tools and API routes.

## Requirements
- **Operating System:** macOS, Linux, or Windows
- **Node.js:** 18+ (recommended 20+)
- **Package Manager:** pnpm (recommended) or npm/yarn
- **Database:** PostgreSQL 14+
- Additional tools: Git

## Technology Stack
- **Framework:** Next.js 14 (App Router)
- **Auth:** NextAuth (Google OAuth)
- **AI:** Vercel AI SDK, OpenAI provider
- **ORM:** Drizzle ORM
- **Database:** PostgreSQL
- **Styling:** Tailwind CSS + DaisyUI
- **Testing:** Vitest

## Installation
1. Clone the repository:
    ```sh
    git clone https://github.com/your-org/ai-sdk-rag.git
    cd ai-sdk-rag
    ```

2. Install dependencies:
    ```sh
    pnpm install
    # or: npm install / yarn install
    ```

3. Set up the database (create the database in Postgres if needed), then run migrations:
    ```sh
    pnpm db:migrate
    ```

## Configuration
Create a `.env` file in the root:
```sh
cp .env.example .env
```
Fill in values (example):
```env
# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_long_random_secret

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Database
DATABASE_URL=postgres://user:pass@localhost:5432/ai_sdk_rag

# AI models and settings (optional overrides)
AI_CHAT_MODEL=gpt-4o-mini
AI_EMBED_MODEL=text-embedding-3-small
AI_TOOL_STEPS=5
EMBED_CHUNK_SIZE=800
EMBED_CHUNK_OVERLAP=100
RAG_TOP_K=5
```

## Usage
1. Start the dev server:
    ```sh
    pnpm dev
    ```
2. Open the app:
    - App: `http://localhost:3000`
    - Sign in with Google (NextAuth)
3. Explore:
    - Dashboard widgets (Today, Events Quick Panel, Upcoming)
    - Settings → Followed Calendars and Theme switcher
    - Chat with assistant (saves history; tools for events)

## Running Tests
Vitest is configured (Vite resolves the `@` alias).
```sh
pnpm test
```
This runs unit tests and integration-style tests for API route handlers (mocked DB/auth/services).

## Deployment
- Ensure all environment variables are set (NextAuth, Google OAuth, Database, AI models).
- Run migrations as part of release:
    ```sh
    pnpm db:migrate
    ```
- Build and start:
    ```sh
    pnpm build
    pnpm start
    ```
- Update OAuth callback URLs in Google Cloud Console to match your deployed domain.

## API Documentation

All endpoints are under the Next.js App Router and typically require an authenticated session (NextAuth). JSON responses unless streaming is used.

- GET `/api/calendars`
  - Auth required. Returns followed calendars from the current user.
  - Response: `{ calendars: [{ calendarId, summary }] }`

- POST `/api/calendars`
  - Auth required. Body: `{ calendarId: string, summary?: string }`
  - Upserts into `user.followed_calendars`.
  - Response: `{ calendar: { id: calendarId, calendarId, summary }, created: boolean }`

- DELETE `/api/calendars?calendarId=...`
  - Auth required. Removes the entry if present.
  - Response: `{ ok: true }`

- GET `/api/calendar/live-events`
  - Auth required. Aggregates events from `primary` + all followed calendars over the next ~30 days.
  - Response: `{ weeklyCount: number, events: [{ id, title, start, end, location?, calendarId?, calendarLabel? }] }`

- POST `/api/chat`
  - Auth required. AI chat streaming endpoint (Vercel AI SDK). Body: `{ messages: UIMessage[] }`.
  - Streams a UIMessage response; client should use the AI SDK client to consume.

- GET `/api/chat/history?limit=15&before=ISO`
  - Auth optional; if not signed in returns `{ messages: [] }`.
  - Paginates chat messages (most recent, then older via `before` which is an ISO date).
  - Response: `{ messages: [{ id, role, content, createdAt }] }`

- POST `/api/chat/history`
  - Auth required. Body: `{ role: 'user'|'assistant', content: string }`
  - Creates the conversation if absent; inserts a message.
  - Response: `{ ok: true, id: string }` or `{ ok: false, error }` with 400/401.

- POST `/api/chat/analyze`
  - Auth required. Body: `{ content: string, messageId?: string }`
  - Extracts schedule-like items heuristically, saves content into `resources` and generates embeddings.
  - Response: `{ ok: true, resourceId, items?: [{ title, time? }] }` or `{ ok: false, error }`.

- DELETE `/api/resources/clear`
  - Auth required. Removes all stored resources and related embeddings for the current user.
  - Response: `{ ok: true, deletedResources: number, deletedEmbeddings: number }`

Notes:
- Tools available to the assistant include fetching/creating events; see `lib/ai/tools` for definitions.
- Errors are returned with appropriate status codes (401 unauthorized, 400 bad input, 500 server).
