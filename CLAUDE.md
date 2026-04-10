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

4. **AI Tools** (`lib/ai/tools/`): Tool-calling system with two categories:
   - **Information tools**: `addResource`, `getInformation` (RAG search), `forgetInformation`, `analyzeFile`
   - **Calendar tools**: `getEvents`, `scheduleEvent`, `deleteEvent`, `optimizeSchedule`

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

### Path Aliases

`@/*` maps to the project root (configured in `tsconfig.json` and `vite.config.ts`).