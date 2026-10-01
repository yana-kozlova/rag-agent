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

pnpm kb:backfill      # Extract entities from notes saved before the graph existed
pnpm kb:compact       # Strip the old prose restatements out of saved notes
pnpm timeline:backfill # Read dates out of notes saved before the timeline existed
pnpm wellbeing:canonicalize # Re-match old symptom labels against the user's vocabulary
pnpm images:prune     # Forget image URLs whose blob object is gone
```

All five maintenance scripts take `--dry`.

Tests live in `test/` and match `test/**/*.test.{ts,tsx}`. Vitest resolves the `@/` alias via `vite.config.ts`.

## Architecture

**Next.js 14 App Router** personal assistant with RAG (Retrieval-Augmented Generation), Google Calendar integration, and a chat UI.

### Core Data Flow

1. **Chat** (`app/api/chat/route.ts`): Streams AI responses via Vercel AI SDK (`streamText`). Uses OpenAI models (configurable via `AI_CHAT_MODEL` env var, defaults to `gpt-4o-mini`). The system prompt is in `app/prompts/system.ts` and gets tool descriptions injected at runtime.

2. **RAG Pipeline** (`lib/ai/embedding.ts`): Text is split into chunks (adaptive by content type: code, lists, tables, paragraphs), embedded via OpenAI (`text-embedding-3-small`), and stored in `embeddings` table with pgvector HNSW index. Retrieval runs two retrievers over the same chunks — pgvector cosine and Postgres full text — and fuses their rankings (`lib/ai/retrieval.ts`), with configurable `RAG_TOP_K` and `RAG_EF_SEARCH`.

3. **Resources** (`lib/actions/resources.ts`, `lib/db/schema/resources.ts`): User-uploaded content (documents, notes, images) stored with metadata. Each resource generates embedding chunks. Supports PDF, DOCX and EPUB extraction (`unpdf`, `mammoth`, `lib/utils/epub.ts`).

4. **Timeline** (`lib/db/schema/timeline.ts`, `lib/timeline/`, `lib/actions/timeline.ts`, `app/timeline/`): the dates a life is measured by — births, moves, weddings, first days, trips, diagnoses — on one ordered axis.

5. **AI Tools** (`lib/ai/tools/`): Tool-calling system with four categories:
   - **Information tools**: `addResource`, `getInformation` (RAG search), `forgetInformation`, `analyzeFile`
   - **Calendar tools**: `getEvents`, `scheduleEvent`, `deleteEvent`, `optimizeSchedule`
   - **Timeline tools** (`lib/ai/tools/timeline/`): `rememberDate`, `getTimeline`
   - **Task tools** (`lib/ai/tools/tasks/`): `addTask`, `getTasks`, `completeTask`, `scheduleTask`
   - **Table tools** (`lib/ai/tools/tables/`): `createTable`, `getTableRows`, `addTableRows`, `extractToTable`, `listTables`, `createQuickAction`, `deleteQuickAction`

6. **Tasks** (`lib/db/schema/tasks.ts`, `lib/tasks/`, `lib/actions/tasks.ts`, `app/tasks/`, `lib/ai/tools/tasks/`): the things that have to be done, with a deadline or without one.

7. **Push / notifications** (`lib/push/`, `app/api/push/`): Proactive briefings, insights, and a weekly retrospective. Notifications are written to the `notification_queue` table first (durability), then delivered two ways: precise-time callbacks via Upstash QStash (`lib/push/qstash.ts`) and a periodic Vercel Cron sweep (`vercel.json` → `/api/push/scheduled`, `/api/push/drain`, `/api/push/retrospective`). Cron- and QStash-invoked routes carry no session and authenticate with `CRON_SECRET` via `validateCronSecret` (`lib/push/utils.ts`); they must therefore be listed in `middleware.ts` `publicPaths`. `sent_notifications` is a dedupe ledger so the same briefing isn't sent twice.

8. **Telegram entry point** (`app/api/telegram/`, `lib/telegram/`): A second surface onto the same assistant. `/api/telegram/webhook` validates the `x-telegram-bot-api-secret-token` header, then hands the update to QStash and returns 200 immediately (Telegram redelivers anything it doesn't get a prompt answer for); `/api/telegram/process` is the callback that actually runs the agent, authenticated with `CRON_SECRET`. Both are in `middleware.ts` `publicPaths`; `/api/telegram/link` is not, because issuing a link code requires a session. Voice notes are transcribed by Groq's `whisper-large-v3-turbo` (`lib/telegram/transcribe.ts`). Chat history is shared with the web chat — same `conversations` row — so a thread continues across surfaces.

9. **Wellbeing tracker** (`lib/db/schema/wellbeing.ts`, `lib/wellbeing/`, `lib/actions/wellbeing.ts`, `app/health/`): mood, energy, sleep and symptoms, logged conversationally and charted.

10. **Response preferences** (`lib/db/schema/directives.ts`, `lib/directives/`, `lib/actions/directives.ts`, `app/api/directives/`, `app/settings/ResponsePreferences.tsx`): standing instructions about how the assistant should answer — language, length, format, what to skip.

### Request context

Tools used to read the NextAuth session directly, which tied them to a browser cookie. They now resolve the user through `lib/auth/context.ts`, an `AsyncLocalStorage` store that falls back to `auth()` when nothing was pushed onto it. The web path is therefore unchanged, while cookie-less callers (Telegram, cron) wrap their work in `runWithUser` and supply the user themselves. Google access tokens for those callers come from `lib/auth/google-token.ts`, which mints them from `accounts.refresh_token` — the token in `accounts.access_token` is never refreshed after sign-in and is not to be trusted. Anything running tools must be on the Node runtime; `AsyncLocalStorage` does not exist on Edge.

### Key Layers

- **Auth**: NextAuth v5 (beta) with Google OAuth, JWT strategy, automatic token refresh. Config in `app/api/auth/auth.ts`. Session includes `accessToken` for Google API calls. Google OAuth scopes include Calendar read/write. Who may hold an account is decided by `ALLOWED_EMAILS` in the `signIn` callback (`lib/auth/allowlist.ts`) — an unset list means open, deliberately, because failing closed on an empty value would lock the owner out on the deploy that introduced the check. Since sessions are JWTs and never re-checked against the database, removing an address only blocks the next sign-in; evicting a live session takes a `NEXTAUTH_SECRET` rotation.
- **Database**: PostgreSQL with Drizzle ORM. Schema files in `lib/db/schema/`. Requires pgvector extension for embeddings (1536-dimension vectors). Followed calendars stored as JSONB on the user record (`users.followed_calendars`).
- **Calendar Service**: `lib/services/calendar.ts` wraps the Google Calendar API. Used by both API routes and AI tools.
- **Environment**: Validated with `@t3-oss/env-nextjs` in `lib/env.mjs`. Set `SKIP_ENV_VALIDATION=1` to bypass validation (useful for build/CI).
- **UI**: Tailwind CSS + DaisyUI with custom themes (silk, bumblebee, autumn). UI primitives in `components/ui/`, app components in `app/components/`.

### Schema Overview

- `users` / `accounts` / `sessions` — NextAuth tables (UUID PKs)
- `resources` — user content with optional metadata (type, tags, facts, entities, key points)
- `entities` / `entity_mentions` — the graph over those notes; `entities.relationship_source` (`model` | `user`) says whether the relation beside the name is extraction's reading or the user's word, and is what stops the next mention overwriting a correction; `entity_aliases` — spellings the user has decided mean an existing node; `entity_exclusions` — names they have decided are not nodes at all, which is what makes a deleted entity stay deleted
- `embeddings` — vector embeddings with source enum (`resource` | `table`), HNSW index. Calendar events are **not** indexed: an early sync that copied them here is gone, and `getEvents` answers from the live API instead.
- `conversations` / `messages` — chat history per user
- `user_tables` / `user_tables_data` — user-created custom tables
- `quick_actions` — a saved row template with a button on it; `fields` is `{ columnId, kind: fixed|today|now|ask, value?, prompt? }[]`, the label is unique per user (it is what a Telegram reply is matched on), and `last_used_at` is what the button reads back as "вже сьогодні"
- `timeline_events` — one row per dated thing, `occurred_on` plus a `precision` saying how much of it is real and a `recurrence` saying whether it comes round; `resource_id` cascades from the note that is its evidence, `entity_id` sets null; `edited_at` is set when the user corrects the row by hand, which is both what the "edited" chip reads and what exempts the row from the note's next wholesale re-sync
- `tasks` — the things that have to be done. Two independent dates: `due_on` (the deadline, never written to Google) and `scheduled_for` (the day of work, which *is* the calendar event, tracked by `google_event_id`). Identity is unique only among open rows, so a task done and raised again is a new one
- `task_completions` — one row per closing, which is the only past a rolling recurrence has; `UNIQUE (task_id, completed_on)` is what makes a double button press safe
- `task_suggestions` — needs already accepted or dismissed. The suggestions themselves have no rows: they are computed from every note's `metadata.needs` minus this table, the mirror of `entity_exclusions`
- `wellbeing_entries` — one row per state check-in (mood/energy 1–5, `sleep_minutes`, symptoms, note), `local_date` denormalised for charting, `resource_id` pointing at the searchable copy of the note
- `assistant_directives` — standing response preferences, injected into every system prompt (capped at 20 × 200 chars, `source` = `user` | `inferred`)
- `users.telegram_chat_id` — where notifications are delivered; an account without one is unreachable
- `users.locale` — `uk` | `en`, the language notifications are written in (default `uk`)
- `notification_queue` — queued notifications (`pending` → `sending` → `sent`|`failed`), delivered via QStash callbacks or the cron sweep
- `sent_notifications` — dedupe ledger of already-delivered notifications

### Path Aliases

`@/*` maps to the project root (configured in `tsconfig.json` and `vite.config.ts`).
### What breaks the build or the data

Each line is the short form of a rule whose reasoning lives in the file named beside it.

- Never `db:push` the `tasks` or `timeline_events` tables — their identity indexes are partial/expression indexes that exist only in the migrations (`.claude/rules/tasks.md`, `.claude/rules/timeline.md`).
- A route called by cron or QStash has no session: it authenticates with `CRON_SECRET` via `validateCronSecret` and must be listed in `middleware.ts` `publicPaths`. Do not rename `/api/push/*` — QStash schedules point at those paths (`.claude/rules/push-briefing.md`).
- Embed first, write second: generate embeddings before touching any row, then swap text and vectors in one transaction (`.claude/rules/retrieval.md`).
- A client component never imports from `lib/db/schema` or anything that pulls in drizzle, `unpdf`, `mammoth` or the AI SDK; shared lists and constants live in dependency-free modules (`lib/utils/resource-types.ts`, `lib/utils/table-columns.ts`, `lib/utils/uploadable.ts`, `lib/utils/calendars.ts`, `lib/wellbeing/scale.ts`, `lib/directives/directives.ts`). Each list has that one copy.
- Vercel Blob has no private tier: nothing harmful-if-leaked goes on the image path (`.claude/rules/resources.md`).
- Anything derived from a date or a count (weekday, lateness, totals, the user's local day) is computed by the application in the user's time zone and handed to the model ready to print, never left for the model or the server clock to derive (`.claude/rules/calendar.md`, `.claude/rules/push-briefing.md`).

### Where the reasoning lives

The reasoning behind each subsystem's non-obvious decisions is in `.claude/rules/`, loaded automatically when a matching file is read. When creating the first file of a kind, or working from a description rather than from a file, open the relevant one by hand.

- `retrieval.md` — hybrid search, fusion, lexical query, `hnsw.ef_search`, embed-then-write (`lib/ai/embedding.ts`, `lib/ai/retrieval.ts`)
- `resources.md` — resource types, images, EPUB, note routing, compaction, merge, note language, batching (`lib/actions/resources.ts`, `lib/ai/information-extraction.ts`, `app/resources/`)
- `entities.md` — entity identity, aliases, rename/merge, delete/restore, relationship (`lib/actions/entity-*.ts`, `app/entities/`)
- `timeline.md` — date precision and recurrence, extraction rules, corrections (`lib/timeline/`, `app/timeline/`)
- `tables-and-links.md` — reading tables, the search-result envelope, citations and `groundLinks`, file cells, table cards (`lib/ai/tools/tables/`, `lib/ai/grounded-links.ts`, `app/tables/`)
- `quick-actions.md` — quick-action buttons, the routine detector, offers, undo, labels (`lib/quick-actions/`)
- `tasks.md` — deadlines vs. scheduled days, suggestions, recurrence, identity, overdue prompts, the briefing's task block (`lib/tasks/`, `app/tasks/`)
- `push-briefing.md` — delivery, how the briefing is assembled, notification language and buttons, cron cadence (`lib/push/`, `app/api/push/`)
- `calendar.md` — `getEvents`, declined events and time blocks, weekdays, conflicts, time zones, followed calendars (`lib/services/calendar.ts`, `lib/utils/calendar*.ts`, `lib/ai/tools/events/`)
- `telegram.md` — plain-text replies, private chats only, media, bot commands (`lib/telegram/`, `app/api/telegram/`)
- `wellbeing.md` — check-ins, aggregation, symptom matching, charts, no assessment (`lib/wellbeing/`, `app/health/`)
- `directives.md` — response preferences in the system prompt (`lib/directives/`)
- `google-access.md` — expired refresh tokens and the reconnect flow (`lib/auth/`, `app/api/google/`)
