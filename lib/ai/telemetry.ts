/**
 * Central LLM usage logging. Every paid OpenAI call in this codebase MUST go
 * through this helper so we have a single place to audit what burns tokens.
 *
 * Rule of thumb: if you add a new generateObject / streamText / embed* call,
 * wire it up here too, otherwise token spend becomes invisible.
 *
 * Written with `console.info`, not `console.log`, and that is load-bearing:
 * `next.config.mjs` strips `console.log` in production builds, so this ledger
 * used to record everything in development and nothing in the deployment where
 * the money is actually spent. `info` is on that file's exclude list.
 */

export type LlmOp = 'embed' | 'embedMany' | 'generateObject' | 'generateText' | 'streamText';

export type LlmUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type LlmLogEntry = {
  op: LlmOp;
  model: string;
  caller: string;
  usage?: LlmUsage;
  /** Input size in characters — useful when token counts aren't available (e.g. embed) */
  inputChars?: number;
  /** Number of values passed to embedMany */
  batchSize?: number;
  /** Wall-clock time in ms */
  durationMs?: number;
  /** Optional extra context */
  note?: string;
};

type Totals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  byOp: Record<string, number>;
  byCaller: Record<string, number>;
};

const totals: Totals = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  byOp: {},
  byCaller: {},
};

export function logLlmUsage(entry: LlmLogEntry): void {
  totals.calls += 1;
  totals.byOp[entry.op] = (totals.byOp[entry.op] ?? 0) + 1;
  totals.byCaller[entry.caller] = (totals.byCaller[entry.caller] ?? 0) + 1;

  if (entry.usage) {
    if (typeof entry.usage.inputTokens === 'number') totals.inputTokens += entry.usage.inputTokens;
    if (typeof entry.usage.outputTokens === 'number') totals.outputTokens += entry.usage.outputTokens;
    if (typeof entry.usage.totalTokens === 'number') totals.totalTokens += entry.usage.totalTokens;
  }

  // Build a single-line log that's grep-friendly
  const parts: string[] = [
    `[LLM]`,
    `op=${entry.op}`,
    `model=${entry.model}`,
    `caller=${entry.caller}`,
  ];
  if (entry.usage?.inputTokens !== undefined) parts.push(`in=${entry.usage.inputTokens}tok`);
  if (entry.usage?.outputTokens !== undefined) parts.push(`out=${entry.usage.outputTokens}tok`);
  if (entry.usage?.totalTokens !== undefined && entry.usage.inputTokens === undefined) {
    parts.push(`total=${entry.usage.totalTokens}tok`);
  }
  if (entry.inputChars !== undefined) parts.push(`chars=${entry.inputChars}`);
  if (entry.batchSize !== undefined) parts.push(`batch=${entry.batchSize}`);
  if (entry.durationMs !== undefined) parts.push(`took=${entry.durationMs}ms`);
  if (entry.note) parts.push(`note="${entry.note}"`);

  // eslint-disable-next-line no-console
  console.info(parts.join(' '));
}

export function getLlmTotals(): Readonly<Totals> {
  return totals;
}

export function resetLlmTotals(): void {
  totals.calls = 0;
  totals.inputTokens = 0;
  totals.outputTokens = 0;
  totals.totalTokens = 0;
  totals.byOp = {};
  totals.byCaller = {};
}
