# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # Start Next.js dev server (http://localhost:3000)
pnpm build            # Production build
pnpm lint             # ESLint
pnpm test             # Run all tests with Vitest
pnpm db:generate      # Generate Drizzle migrations
pnpm db:migrate       # Run migrations (tsx lib/db/migrate.ts)
pnpm db:push          # Push schema directly to DB
pnpm db:studio        # Open Drizzle Studio
```

Tests live in `test/` and match `test/**/*.test.{ts,tsx}`. Vitest resolves the `@/` alias via `vite.config.ts`.

## Architecture

**Next.js 14 App Router** personal assistant with RAG (Retrieval-Augmented Generation), Google Calendar integration, and a chat UI.

### Core Data Flow

1. **Chat** (`app/api/chat/route.ts`): Streams AI responses via Vercel AI SDK (`streamText`). Uses OpenAI models (configurable via `AI_CHAT_MODEL` env var, defaults to `gpt-4o-mini`). The system prompt is in `app/prompts/system.ts` and gets tool descriptions injected at runtime.

2. **RAG Pipeline** (`lib/ai/embedding.ts`): Text is split into chunks (adaptive by content type: code, lists, tables, paragraphs), embedded via OpenAI (`text-embedding-3-small`), and stored in `embeddings` table with pgvector HNSW index. Retrieval uses hybrid search (cosine similarity + keyword scoring) with configurable `RAG_TOP_K`.

3. **Resources** (`lib/actions/resources.ts`, `lib/db/schema/resources.ts`): User-uploaded content (documents, notes) stored with metadata. Each resource generates embedding chunks. Supports PDF and DOCX extraction (`mammoth`, `unpdf`).

**Books are the reason embedding is batched.** A book chunks into the high hundreds, past OpenAI's per-request ceiling of 2048 inputs / 300k tokens, so `generateEmbeddings` splits into sequential batches — one request per book would fail on exactly the uploads this was built for. For the same reason `extractStructuredInformation` reads only the first 60k characters: a whole book exceeds any chat model's context, and an over-long prompt fails both attempts and leaves the book with no tags, facts or entities at all.

4. **AI Tools** (`lib/ai/tools/`): Tool-calling system with three categories:
   - **Information tools**: `addResource`, `getInformation` (RAG search), `forgetInformation`, `analyzeFile`
   - **Calendar tools**: `getEvents`, `scheduleEvent`, `deleteEvent`, `optimizeSchedule`
   - **Table tools** (`lib/ai/tools/tables/`): `createTable`, `addTableRows`, `extractToTable`, `listTables`

5. **Push / notifications** (`lib/push/`, `app/api/push/`): Proactive web-push briefings, insights, and a weekly retrospective. Notifications are written to the `notification_queue` table first (durability), then delivered two ways: precise-time callbacks via Upstash QStash (`lib/push/qstash.ts`) and a periodic Vercel Cron sweep (`vercel.json` → `/api/push/scheduled`, `/api/push/drain`, `/api/push/retrospective`). Cron- and QStash-invoked routes carry no session and authenticate with `CRON_SECRET` via `validateCronSecret` (`lib/push/utils.ts`); they must therefore be listed in `middleware.ts` `publicPaths`. `sent_notifications` is a dedupe ledger so the same briefing isn't sent twice.

**Cron cadence lives in QStash, not `vercel.json`.** The Hobby plan rejects any cron firing more than once a day, and these endpoints ask "who is due right now?" rather than planning a day ahead — so a daily sweep alone drops nearly every briefing. QStash schedules call the same paths with the same `CRON_SECRET`; the entries left in `vercel.json` are a once-a-day backstop for when QStash is unreachable. Changing a briefing's cadence means editing the QStash schedule, not `vercel.json`.

6. **Telegram entry point** (`app/api/telegram/`, `lib/telegram/`): A second surface onto the same assistant. `/api/telegram/webhook` validates the `x-telegram-bot-api-secret-token` header, then hands the update to QStash and returns 200 immediately (Telegram redelivers anything it doesn't get a prompt answer for); `/api/telegram/process` is the callback that actually runs the agent, authenticated with `CRON_SECRET`. Both are in `middleware.ts` `publicPaths`; `/api/telegram/link` is not, because issuing a link code requires a session. Voice notes are transcribed by Groq's `whisper-large-v3-turbo` (`lib/telegram/transcribe.ts`). Chat history is shared with the web chat — same `conversations` row — so a thread continues across surfaces.

### Request context

Tools used to read the NextAuth session directly, which tied them to a browser cookie. They now resolve the user through `lib/auth/context.ts`, an `AsyncLocalStorage` store that falls back to `auth()` when nothing was pushed onto it. The web path is therefore unchanged, while cookie-less callers (Telegram, cron) wrap their work in `runWithUser` and supply the user themselves. Google access tokens for those callers come from `lib/auth/google-token.ts`, which mints them from `accounts.refresh_token` — the token in `accounts.access_token` is never refreshed after sign-in and is not to be trusted. Anything running tools must be on the Node runtime; `AsyncLocalStorage` does not exist on Edge.

### Key Layers

- **Auth**: NextAuth v5 (beta) with Google OAuth, JWT strategy, automatic token refresh. Config in `app/api/auth/auth.ts`. Session includes `accessToken` for Google API calls. Google OAuth scopes include Calendar read/write.
- **Database**: PostgreSQL with Drizzle ORM. Schema files in `lib/db/schema/`. Requires pgvector extension for embeddings (1536-dimension vectors). Followed calendars stored as JSONB on the user record (`users.followed_calendars`).
- **Calendar Service**: `lib/services/calendar.ts` wraps the Google Calendar API. Used by both API routes and AI tools.
- **Environment**: Validated with `@t3-oss/env-nextjs` in `lib/env.mjs`. Set `SKIP_ENV_VALIDATION=1` to bypass validation (useful for build/CI).
- **UI**: Tailwind CSS + DaisyUI with custom themes (silk, bumblebee, autumn). UI primitives in `components/ui/`, app components in `app/components/`.

### Schema Overview

- `users` / `accounts` / `sessions` — NextAuth tables (UUID PKs)
- `resources` — user content with optional metadata (type, tags, facts, entities, key points)
- `embeddings` — vector embeddings with source enum (`resource` | `calendar` | `table`), HNSW index
- `conversations` / `messages` — chat history per user
- `user_tables` / `user_tables_data` — user-created custom tables
- `push_subscriptions` — web push notification subscriptions
- `notification_queue` — queued notifications (`pending` → `sending` → `sent`|`failed`), delivered via QStash callbacks or the cron sweep
- `sent_notifications` — dedupe ledger of already-delivered notifications

### Path Aliases

`@/*` maps to the project root (configured in `tsconfig.json` and `vite.config.ts`).