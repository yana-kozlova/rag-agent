import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Don't import dotenv/config here as Next.js handles it

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
    NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),
    NEXTAUTH_URL: z.string().url().default("http://localhost:3000"),
    GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
    GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
    AI_CHAT_MODEL: z.string().optional(),
    AI_EMBED_MODEL: z.string().optional(),
    AI_TOOL_STEPS: z.coerce.number().optional(),
    EMBED_CHUNK_SIZE: z.coerce.number().optional(),
    EMBED_CHUNK_OVERLAP: z.coerce.number().optional(),
    RAG_TOP_K: z.coerce.number().optional(),
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),
    CRON_SECRET: z.string().optional(),
    // Upstash QStash delivers queued notifications at their exact instant.
    // Optional: without it the queue still drains, just on the sweep's cadence.
    QSTASH_TOKEN: z.string().optional(),
    // Public origin QStash calls back into. Falls back to NEXTAUTH_URL, which
    // is the same origin in every deployment this app has.
    APP_URL: z.string().url().optional(),
  },
  client: {
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    AI_CHAT_MODEL: process.env.AI_CHAT_MODEL,
    AI_EMBED_MODEL: process.env.AI_EMBED_MODEL,
    AI_TOOL_STEPS: process.env.AI_TOOL_STEPS,
    EMBED_CHUNK_SIZE: process.env.EMBED_CHUNK_SIZE,
    EMBED_CHUNK_OVERLAP: process.env.EMBED_CHUNK_OVERLAP,
    RAG_TOP_K: process.env.RAG_TOP_K,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    QSTASH_TOKEN: process.env.QSTASH_TOKEN,
    APP_URL: process.env.APP_URL,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});