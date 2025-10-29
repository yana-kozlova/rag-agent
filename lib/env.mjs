import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Don't import dotenv/config here as Next.js handles it

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
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
  },
  client: {},
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
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
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});