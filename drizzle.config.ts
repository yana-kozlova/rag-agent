import type { Config } from 'drizzle-kit';
import { env } from '@/lib/env.mjs';

export default {
  schema: './lib/db/schema',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  tablesFilter: ["!libsql_wasm_func_table"],
  verbose: true,
  strict: true,
} satisfies Config;