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

3. **Resources** (`lib/actions/resources.ts`, `lib/db/schema/resources.ts`): User-uploaded content (documents, notes, images) stored with metadata. Each resource generates embedding chunks. Supports PDF, DOCX and EPUB extraction (`unpdf`, `mammoth`, `lib/utils/epub.ts`).

**Images are stored as text.** A photo or screenshot is read once at the door by a vision model (`lib/ai/vision.ts`, `AI_VISION_MODEL`, defaults to the chat model) which names what it shows and transcribes any text on it verbatim; that description becomes the resource's `content`, so chunking, embedding, extraction and hybrid search all work unchanged and never learn about a second modality. The bytes go to Vercel Blob (`lib/storage/images.ts`, `BLOB_READ_WRITE_TOKEN`) and the URL is kept in `metadata.imageUrl`. Both halves degrade independently and on purpose: a failed description aborts the upload (an unsearchable image is invisible to the assistant), while a failed store only logs and the resource is saved without a URL. `lib/actions/save-image.ts` owns that ordering so no surface re-decides it. Note that Vercel Blob has no private tier — every object is served publicly and the unguessable URL is the only protection, so nothing harmful-if-leaked belongs here. Client-side pickers validate against `lib/utils/uploadable.ts`, which is dependency-free precisely so a client component never pulls `unpdf`/`mammoth`/the AI SDK into the browser bundle.

**An EPUB is read in spine order.** An EPUB is a ZIP of XHTML read in the order the package document's *spine* gives, not filename order — concatenating the files alphabetically scrambles the book and makes retrieved passages read as if they came from the wrong chapter. Extraction lives in `lib/utils/epub.ts` (no XML parser: the two files that need reading have a flat shape and the rest is being reduced to text anyway); DRM-protected books are detected via `META-INF/encryption.xml` and refused, because their XHTML unzips fine and decodes to noise.

**Books are the reason embedding is batched.** A book chunks into the high hundreds, past OpenAI's per-request ceiling of 2048 inputs / 300k tokens, so `generateEmbeddings` splits into sequential batches — one request per book would fail on exactly the uploads this was built for. For the same reason `extractStructuredInformation` reads only the first 60k characters: a whole book exceeds any chat model's context, and an over-long prompt fails both attempts and leaves the book with no tags, facts or entities at all.

4. **AI Tools** (`lib/ai/tools/`): Tool-calling system with three categories:
   - **Information tools**: `addResource`, `getInformation` (RAG search), `forgetInformation`, `analyzeFile`
   - **Calendar tools**: `getEvents`, `scheduleEvent`, `deleteEvent`, `optimizeSchedule`
   - **Table tools** (`lib/ai/tools/tables/`): `createTable`, `addTableRows`, `extractToTable`, `listTables`

5. **Push / notifications** (`lib/push/`, `app/api/push/`): Proactive briefings, insights, and a weekly retrospective. Notifications are written to the `notification_queue` table first (durability), then delivered two ways: precise-time callbacks via Upstash QStash (`lib/push/qstash.ts`) and a periodic Vercel Cron sweep (`vercel.json` → `/api/push/scheduled`, `/api/push/drain`, `/api/push/retrospective`). Cron- and QStash-invoked routes carry no session and authenticate with `CRON_SECRET` via `validateCronSecret` (`lib/push/utils.ts`); they must therefore be listed in `middleware.ts` `publicPaths`. `sent_notifications` is a dedupe ledger so the same briefing isn't sent twice.

**"Push" is the schedule, not the transport.** Delivery is Telegram, through the one door in `lib/push/deliver.ts`; Web Push is gone, along with `push_subscriptions`, the service worker, the VAPID keys and `/api/push/{subscribe,vapid-key,send,action}`. A subscription bound notifications to one browser profile, expired without telling anyone, and on iOS existed only for an installed PWA — so briefings were reliably generated and unreliably seen. What makes an account reachable is now `users.telegram_chat_id`, which is also what the dispatchers select on; before, they joined `push_subscriptions` and silently skipped everyone who had never granted browser notifications. The names (`lib/push/`, `/api/push/*`) stay because QStash schedules point at those paths — renaming the routes means re-creating every schedule.

**The briefing is assembled, not dictated.** The model writes only the opening paragraph; the schedule under it is built from the events in `scheduleLines` (`lib/push/briefing.ts`). A model handed times and asked to repeat them eventually repeats one wrong, and a briefing that misstates when a meeting starts is worse than none — so a failed generation costs the sentence and never the list. The old 180-character ceiling was a browser-notification constraint (two visible lines) and is gone; the limits now are editorial, `MAX_HEADLINE` and `MAX_EVENT_LINES`. The retrospective works the same way, with `plainRetrospective`'s numbers printed under the model's reflection.

**Notification language is `users.locale` (`uk` | `en`), and only notifications.** All copy — titles, deterministic fallbacks, durations, and the `writeIn` line appended to each generation prompt — lives in `lib/push/copy.ts`; the web UI stays English, because a notification is read where the bot speaks and a settings screen is not. Ukrainian's three plural forms are why counts go through `pluralUk` rather than a ternary. Clock times are `en-GB` in both languages on purpose: digits are digits, and a locale-shifted format only makes the briefing's column of times ragged. An unrecognised stored locale resolves to the default instead of throwing, since it would otherwise fail a cron run that has already paid for an LLM call.

Notification buttons are Telegram inline keyboards. `callback_data` is capped at 64 bytes and there is no session cookie on a press, so an action is a name plus a number (`lib/telegram/callback-data.ts`) and everything else is read back off the message text it was attached to — which is why `renderNotification` joins title and body with a blank line and `splitNotification` cuts on it. `handleCallbackQuery` (`lib/telegram/callbacks.ts`) resolves the user from the chat id exactly as an ordinary message does, then strips the keyboard so a week-old briefing can't be saved twice.

**Cron cadence lives in QStash, not `vercel.json`.** The Hobby plan rejects any cron firing more than once a day, and these endpoints ask "who is due right now?" rather than planning a day ahead — so a daily sweep alone drops nearly every briefing. QStash schedules call the same paths with the same `CRON_SECRET`; the entries left in `vercel.json` are a once-a-day backstop for when QStash is unreachable. Changing a briefing's cadence means editing the QStash schedule, not `vercel.json`.

6. **Telegram entry point** (`app/api/telegram/`, `lib/telegram/`): A second surface onto the same assistant. `/api/telegram/webhook` validates the `x-telegram-bot-api-secret-token` header, then hands the update to QStash and returns 200 immediately (Telegram redelivers anything it doesn't get a prompt answer for); `/api/telegram/process` is the callback that actually runs the agent, authenticated with `CRON_SECRET`. Both are in `middleware.ts` `publicPaths`; `/api/telegram/link` is not, because issuing a link code requires a session. Voice notes are transcribed by Groq's `whisper-large-v3-turbo` (`lib/telegram/transcribe.ts`). Chat history is shared with the web chat — same `conversations` row — so a thread continues across surfaces.

**One bot serves many people, and only in private chats.** The binding is a per-user column (`users.telegram_chat_id`, unique), so every account that can sign in can link its own chat to the same bot; `findUserByChatId` resolves the owner per update and `runWithUser` scopes the agent to them. The gate on all of it is `ALLOWED_EMAILS`, since a code can only be issued from an authenticated session. That same design is why group and channel updates are dropped (`isPrivateChat` in `lib/telegram/process.ts`): a chat id is the entire identity here — nothing asks *which* member is speaking — so a linked group would hand every current and future member the owner's knowledge base and calendar. `/unlink` lives on the bot side rather than only in settings, because someone who was invited to this instance may never open the web app again and still needs to stop the bot answering as them. For the same reason user-facing failures never name an env var: whoever is typing may be a guest on someone else's deployment, so the setting goes to the log and the chat gets "write to me in text instead".

Photos and documents (`lib/telegram/media.ts`) are **saved, not discussed**: they arrive with no question attached, so `processUpdate` ends the turn on them rather than feeding a wall of OCR to the agent and burning its step budget. The reply quotes back what was actually read, because vision output is the one thing here the user cannot verify against a source — a misread figure on a receipt has to be caught while the paper is still in hand. A caption becomes the title. Telegram re-encodes photos to JPEG, so HEIC never reaches this path; images sent *as documents* (what you do when compression would make a page of text unreadable) are detected and routed to the image path rather than rejected.

7. **Wellbeing tracker** (`lib/db/schema/wellbeing.ts`, `lib/wellbeing/`, `lib/actions/wellbeing.ts`, `app/health/`): mood, energy, sleep and symptoms, logged conversationally and charted.

**State is stored twice, on purpose.** The scales go to `wellbeing_entries` where a chart can read them; the user's own words also go to `resources` (linked by `resource_id`) where retrieval can. Neither half does the other's job — no amount of embedding turns a paragraph into a trend line, and no column answers "коли востаннє боліла голова?" the way a semantic search does. The row is written first and the note indexed after: the measurement is durable and costs one INSERT, indexing costs an embedding call that may fail, and a flaky OpenAI call must never cost the user the number. This is also why `logWellbeing` exists as a separate tool rather than letting `addResource` take it — that tool is instructed to save personal facts proactively and will otherwise swallow "болить голова" as prose.

**One row per check-in, never one per day.** "Зранку добре, після обіду розболілась голова" is two measurements and the time between them is the part worth seeing; an in-place update would keep only the second. Folding into one point per day happens at read time in `lib/wellbeing/aggregate.ts`, where the rules are visible and reversible: mood and energy are averaged over the day, sleep is *not* — it describes one night, so a second value is a correction and the later one wins, where averaging 6 and a corrected 6.5 would produce a night nobody slept. Days with no check-in stay in the series as empty points so the chart breaks the line rather than drawing through the gap — the missing stretch is usually the bad one. Symptoms are counted per day, not per mention, so complaining volubly on one afternoon doesn't outrank a symptom that persists for a week.

**A symptom is only trackable if it lands on the same label twice.** Left to itself the model names things fresh each time — "голова важка й мутна" came back as `["важка", "мутна"]` — so the frequency chart filled with one-off adjectives and reported that nothing ever recurs, which is exactly backwards. Two fixes, both needed: the `symptoms` parameter description demands noun phrases naming the complaint (bare adjectives and severity words belong in `note`), and `lib/wellbeing/symptoms.ts` matches each incoming label against the vocabulary this user has already used, keying on stems rather than text. The stemmer is crude on purpose — strip one inflectional ending, strip a trailing adjectival `-н-`, fold `і`→`о` for the closed-syllable alternation — which is what makes "головний біль", "болить голова" and "головного болю" one bar instead of three. Matching requires *every* token to agree, and the display name is always a spelling the user's own check-in produced; synonyms ("втома" / "виснаження") are deliberately never merged, because that is a judgement call and collapsing it silently destroys a distinction they drew.

`localDate` is denormalised because charts group by local day and re-deriving that from a UTC instant applies today's offset to an entry made before a DST change. `sleep_minutes` is an integer because "7 год 20 хв" as a float comes back out as something else. The 1–5 scale is enforced in zod *and* as a SQL CHECK: a 7 on a 1–5 axis is not a bad reading, it is a broken chart. `sleepMoodSplit` returns null until both buckets hold five days, because a split computed from two nights reads exactly like a finding.

Charts are hand-written SVG (`app/components/wellbeing/charts.tsx`) — a charting library would be the largest thing in the client bundle for two charts of at most a year of single-value points. Colours are DaisyUI channel variables so the theme switcher still works. `WELLBEING_SCALE_MIN`/`MAX` live in `lib/wellbeing/scale.ts` rather than beside the column they constrain, and the schema imports *them*: the charts are client components, and importing from the schema would drag drizzle and every table definition into the browser (same reason as `lib/utils/uploadable.ts`).

**The tracker records; it does not assess.** The system prompt forbids diagnosis, causal explanation and medical advice, and the page says so in as many words. Deletion is an API route, not a tool — a mislogged number is corrected by looking at the row, and a model choosing which measurement to drop is a failure mode this data cannot afford. Health is also the most sensitive content in the base, which makes the Blob caveat above load-bearing: photos of lab results or prescriptions do not belong on the image path, where an unguessable public URL is the only protection.

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
- `embeddings` — vector embeddings with source enum (`resource` | `table`), HNSW index. Calendar events are **not** indexed: an early sync that copied them here is gone, and `getEvents` answers from the live API instead.
- `conversations` / `messages` — chat history per user
- `user_tables` / `user_tables_data` — user-created custom tables
- `wellbeing_entries` — one row per state check-in (mood/energy 1–5, `sleep_minutes`, symptoms, note), `local_date` denormalised for charting, `resource_id` pointing at the searchable copy of the note
- `users.telegram_chat_id` — where notifications are delivered; an account without one is unreachable
- `users.locale` — `uk` | `en`, the language notifications are written in (default `uk`)
- `notification_queue` — queued notifications (`pending` → `sending` → `sent`|`failed`), delivered via QStash callbacks or the cron sweep
- `sent_notifications` — dedupe ledger of already-delivered notifications

### Path Aliases

`@/*` maps to the project root (configured in `tsconfig.json` and `vite.config.ts`).