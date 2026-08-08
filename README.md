# AI SDK RAG

A personal assistant that remembers. Upload documents, notes, photos and books; ask about them
in chat or from Telegram; let it read your calendar, book meetings, and send you a briefing in
the morning. Built on Next.js 14 (App Router), the Vercel AI SDK, Drizzle and Postgres with
pgvector.

## Table of Contents
1. [What it does](#what-it-does)
2. [Requirements](#requirements)
3. [Technology stack](#technology-stack)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [Who can sign in](#who-can-sign-in)
7. [Telegram](#telegram)
8. [Scheduled notifications](#scheduled-notifications)
9. [Running tests](#running-tests)
10. [Deployment](#deployment)
11. [API reference](#api-reference)
12. [Further reading](#further-reading)

## What it does

**Knowledge base.** Documents (PDF, DOCX, EPUB, TXT), pasted notes, and photos become
`resources`: chunked, embedded with `text-embedding-3-small`, and stored in pgvector. Books are
read in spine order and embedded in batches, because one request per book exceeds OpenAI's
per-call ceiling. Images are read once at the door by a vision model and stored **as their
description** — so search, extraction and chunking never learn about a second modality.

**Retrieval.** Hybrid: vector similarity plus Postgres full-text search, with query expansion
in front of it. Managed from chat through the `addResource`, `getInformation`,
`forgetInformation` and `analyzeFile` tools.

**Entity graph.** People, places and projects mentioned across resources are extracted and
linked, browsable at `/entities`.

**Timeline.** The dates worth finding years from now — births, moves, weddings, first days,
trips, diagnoses — on one axis at `/timeline`, read out of the notes you save or stated
outright (`rememberDate`, `getTimeline`). A date is kept only as precisely as it was given: a
year stays a year and is never shown as 1 January, and a birthday with no year repeats every
year without claiming an age. Anniversaries falling in the week ahead ride into the morning
briefing. Notes saved before this existed are swept with `pnpm timeline:backfill`.

**Calendar.** Live events across the primary and followed calendars, with tools to schedule,
delete and rearrange. Followed calendars live on the user record (`users.followed_calendars`).

**Tables.** User-defined tables, filled by hand or by asking the assistant to extract rows out
of something it already knows (`createTable`, `addTableRows`, `extractToTable`, `listTables`).

**Two front doors.** The web chat and a Telegram bot share one conversation thread, one
knowledge base and one calendar — a thread continues across surfaces. Telegram also takes voice
notes (transcribed by Groq's `whisper-large-v3-turbo`), photos and documents.

**Proactive notifications.** A morning briefing, nudges during the day, and a Sunday
retrospective, queued in Postgres and delivered to Telegram with inline action buttons.
Notification copy follows `users.locale` (`uk` | `en`); the web UI stays English.

## Requirements
- **Node.js:** 18+ (recommended 20+)
- **Package manager:** pnpm (recommended) or npm/yarn
- **Database:** PostgreSQL 14+ with the `pgvector` extension
- **OS:** macOS, Linux, or Windows

## Technology stack
- **Framework:** Next.js 14 (App Router), React, TypeScript
- **AI:** Vercel AI SDK, OpenAI (chat, embeddings, vision), Groq (speech-to-text)
- **Auth:** NextAuth v5 (Google OAuth, JWT sessions)
- **Data:** Postgres + pgvector, Drizzle ORM
- **Infrastructure:** Upstash QStash (scheduling and async work), Vercel Blob (image storage),
  Vercel Cron (backstop)
- **UI:** Tailwind CSS + DaisyUI
- **Tests:** Vitest

## Installation

1. Clone and install:
   ```sh
   git clone https://github.com/your-org/ai-sdk-rag.git
   cd ai-sdk-rag
   pnpm install
   ```

2. Create the database and enable pgvector:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

3. Write a `.env` (see [Configuration](#configuration)), then run migrations:
   ```sh
   pnpm db:migrate
   ```

4. Start the dev server on http://localhost:3000:
   ```sh
   pnpm dev
   ```

Sign in with Google, then explore: the dashboard (today, upcoming, week strip), `/resources`,
`/entities`, `/tables`, and `/settings`.

## Configuration

Environment variables are validated by `@t3-oss/env-nextjs` in `lib/env.mjs`; set
`SKIP_ENV_VALIDATION=1` to bypass that for a build or CI run.

**Required:**

```env
DATABASE_URL=postgres://user:pass@localhost:5432/ai_sdk_rag
OPENAI_API_KEY=sk-...
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_long_random_secret
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

**Optional:**

| Variable | Purpose |
| --- | --- |
| `ALLOWED_EMAILS` | Who may sign in. Unset means anyone with a Google account — see below |
| `AI_CHAT_MODEL` | Chat model (default `gpt-4o-mini`) |
| `AI_VISION_MODEL` | Model that reads images (defaults to the chat model) |
| `AI_EMBED_MODEL` | Embedding model (default `text-embedding-3-small`) |
| `AI_TOOL_STEPS` | Agent step budget per turn |
| `EMBED_CHUNK_SIZE`, `EMBED_CHUNK_OVERLAP` | Chunking |
| `RAG_TOP_K` | How many chunks retrieval returns |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | The Telegram surface |
| `GROQ_API_KEY` | Voice-note transcription; without it the bot asks for text |
| `BLOB_READ_WRITE_TOKEN` | Keeps sent images; without it only the text read off them is stored |
| `CRON_SECRET` | Authenticates cron, QStash and Telegram callbacks |
| `QSTASH_TOKEN`, `APP_URL` | Scheduling, and the origin QStash calls back into |

Google OAuth needs the Calendar read/write scopes and a callback URL of
`<NEXTAUTH_URL>/api/auth/callback/google`.

## Who can sign in

Google OAuth proves who someone is; it does not decide that they belong here. A deployment
without `ALLOWED_EMAILS` accepts **any** Google account — each new sign-up gets its own
knowledge base and spends your OpenAI and Groq budget doing it.

```env
ALLOWED_EMAILS=you@gmail.com,friend@gmail.com   # whole addresses
ALLOWED_EMAILS=@yourcompany.com                 # or a domain, with the leading @
```

- **Unset means open.** That is the default on purpose — failing closed on an empty value
  would lock you out of your own instance on the deploy that added the check. Production
  logs a warning at the first sign-in instead.
- Refused accounts land back on `/signin` with a message; no user row is created for them.
- Sessions are JWTs and are not re-checked against the database, so **removing an address
  only blocks the next sign-in**. To evict a session already in flight, rotate
  `NEXTAUTH_SECRET` — that signs everyone out, including you.

## Telegram

The bot is a second door onto the same assistant: same knowledge base, same calendar, same
conversation thread as the web chat. Text, voice notes, photos and documents all work.

**One bot, several people.** The binding is per user (`users.telegram_chat_id`), not global,
so everyone who has an account here can link their own chat to the same bot and see only
their own data. What gates that is `ALLOWED_EMAILS` above — a chat can only be linked by
someone who can already sign in to the web app.

**Setup:**

1. Create the bot with [@BotFather](https://t.me/BotFather) → `/newbot`, and put the token in
   `TELEGRAM_BOT_TOKEN`.
2. Pick any long random string for `TELEGRAM_WEBHOOK_SECRET`. In production an unset secret
   makes the webhook refuse every update — anyone who learned the URL could otherwise post
   messages as your users.
3. Register the webhook (re-run this whenever the deployment URL or the secret changes):
   ```sh
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=https://your-app.vercel.app/api/telegram/webhook" \
     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
   ```
4. Optional but recommended: with `QSTASH_TOKEN` set, the webhook hands each update to QStash
   and answers Telegram immediately. Without it the agent runs inline, which is slower and
   risks Telegram redelivering the same message.
5. Optional: `GROQ_API_KEY` for voice notes, `BLOB_READ_WRITE_TOKEN` to keep the images
   themselves. Both degrade quietly — the bot says it needs text, or saves only what it read.
6. Give BotFather the command list via `/setcommands`:
   ```
   start - link this chat to an account
   unlink - detach this chat
   help - what I can do
   ```

**For each person using it:**

1. Sign in to the web app → **Settings → Telegram → Generate code**.
2. Send the bot `/start <code>` (or use the "Open in Telegram" link). The code is single-use
   and expires in 10 minutes.
3. `/help` lists what the bot understands; `/unlink` detaches the chat again and deletes
   nothing — the knowledge base belongs to the account, not to the chat.

**Worth knowing:**

- **Private chats only.** A chat id is the entire identity the bot has, so in a group every
  member — including anyone added later — would speak as the linked account. Group and channel
  messages are ignored, and a command sent there gets a short "write to me directly" instead.
- **Images live behind public URLs.** Vercel Blob has no private tier; an unguessable URL is
  the only protection on a sent photo. The bot says so in `/help`. Do not send documents that
  must not leak.
- **There are no per-user quotas.** Everyone linked to the bot spends the same API budget —
  yours. Keep `ALLOWED_EMAILS` to people you would hand your API key to.

## Scheduled notifications

A morning briefing, proactive nudges during the day, and a Sunday retrospective —
delivered to Telegram. There is no browser channel: Web Push was removed because a
subscription belongs to one browser profile, expires without saying so, and on iOS
only exists for an installed PWA.

**Setup:**
1. Link a chat — Settings → Telegram → generate a code, send `/start <code>` to the bot.
   An account with no linked chat is skipped by the dispatchers entirely.
2. Add `CRON_SECRET` to `.env`. It authenticates every scheduled endpoint, and in
   production an unset value makes them refuse to run rather than run unguarded.
3. Choose what and when in Settings → Notifications.

**Cadence** lives in QStash schedules, not `vercel.json` — the endpoints ask "who is due
right now?", so they need to fire hourly, and Vercel's Hobby plan allows a cron at most
once a day. The `vercel.json` entries are a once-a-day backstop for when QStash is
unreachable. See [docs/push-scheduling.md](docs/push-scheduling.md).

## Running tests

```sh
pnpm test       # Vitest, watch mode
pnpm lint       # ESLint
```

Tests live in `test/` and cover pure logic and route handlers with the database, auth and
external services mocked. Vitest resolves the `@/` alias through `vite.config.ts`.

## Deployment

1. Set every environment variable in the host (Vercel: Project → Settings → Environment
   Variables). `SKIP_ENV_VALIDATION=1` is only for builds without secrets.
2. Run migrations against the production database as part of the release:
   ```sh
   pnpm db:migrate
   ```
3. Add the deployed domain to the Google Cloud Console OAuth callback URLs.
4. Re-register the Telegram webhook against the deployed URL (see [Telegram](#telegram)).
5. Create the QStash schedules that drive notifications — `vercel.json` alone fires each
   endpoint once a day, which is not often enough. See
   [docs/push-scheduling.md](docs/push-scheduling.md).
6. Build and start:
   ```sh
   pnpm build && pnpm start
   ```

Anything that runs AI tools must stay on the Node runtime: request context uses
`AsyncLocalStorage`, which does not exist on Edge.

## API reference

Everything is under the App Router. Routes require a NextAuth session unless noted; the
exceptions are listed in `middleware.ts` `publicPaths` and authenticate by shared secret
instead.

**Chat**
| Route | Purpose |
| --- | --- |
| `POST /api/chat` | Streaming chat with tools (Vercel AI SDK protocol) |
| `GET /api/chat/history?limit=&before=` | Paginated history, newest first |
| `POST /api/chat/history` | Append one message |

**Knowledge base**
| Route | Purpose |
| --- | --- |
| `GET /api/resources` | List resources |
| `GET`, `PATCH`, `DELETE /api/resources/[id]` | Read, edit, remove one resource |
| `POST /api/resources/upload` | Upload a file; extracts text and embeds it |
| `POST /api/resources/extract-text` | Extract text from a file without saving it |
| `GET /api/resources/search?q=` | Hybrid search over the knowledge base |
| `GET /api/resources/tags` | Tags in use |
| `DELETE /api/resources/clear` | Remove every resource and embedding for the user |
| `GET /api/entities` | Entity graph |

**Calendar**
| Route | Purpose |
| --- | --- |
| `GET /api/calendar/live-events` | Events across primary + followed calendars |
| `GET`, `POST`, `DELETE /api/calendars` | Manage followed calendars |

**Timeline**
| Route | Purpose |
| --- | --- |
| `GET /api/timeline?days=` | The whole axis, plus what is coming up |
| `GET /api/timeline?view=upcoming&days=` | Only the projected dates ahead (what the widget asks for) |
| `POST /api/timeline` | Record one date by hand |
| `DELETE /api/timeline?id=` | Remove one |

**Tables**
| Route | Purpose |
| --- | --- |
| `GET`, `POST /api/user-tables` | List and create tables |
| `GET`, `PATCH`, `DELETE /api/user-tables/[id]` | One table |
| `GET`, `POST /api/user-tables/[id]/data` | Rows |
| `PATCH`, `DELETE /api/user-tables/[id]/data/[rowId]` | One row |

**Notifications** — `preferences` and `next-scheduled` need a session; the rest are
`CRON_SECRET`-authenticated and public in the middleware.
| Route | Purpose |
| --- | --- |
| `GET`, `PUT /api/push/preferences` | What to send and when |
| `GET /api/push/next-scheduled` | The next queued notification |
| `GET /api/push/scheduled` | Sweep: who is due right now |
| `POST`, `GET /api/push/drain` | Deliver anything pending in the queue |
| `POST /api/push/briefing-user` | Build and send one user's briefing |
| `GET /api/push/retrospective` | Weekly retrospective |

**Telegram**
| Route | Purpose |
| --- | --- |
| `POST /api/telegram/webhook` | Updates from Telegram; verifies the secret token, then queues |
| `POST /api/telegram/process` | QStash callback that runs the agent (`CRON_SECRET`) |
| `GET`, `POST /api/telegram/link` | Read link status, issue a link code (**session required**) |

## Further reading

- [docs/architecture.md](docs/architecture.md) — how the pieces fit: layers, chat flow, RAG
  pipeline, notification dispatch, deployment topology
- [docs/database-schema.md](docs/database-schema.md) — tables, relationships, cascade map
- [docs/push-scheduling.md](docs/push-scheduling.md) — QStash schedules and cadence
- [CLAUDE.md](CLAUDE.md) — conventions and the reasoning behind the non-obvious decisions
