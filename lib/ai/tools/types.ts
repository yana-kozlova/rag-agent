import { z } from 'zod';

/**
 * What the model receives for a tool result. Mirrors the AI SDK's
 * LanguageModelV2ToolResultOutput. Returning `json` with the legacy payload
 * lets a tool hand the UI a richer object via `execute` while keeping the
 * model's input byte-identical to before.
 */
export type ToolModelOutput =
  | { type: 'text'; value: string }
  | { type: 'json'; value: unknown }
  | { type: 'error-text'; value: string }
  | { type: 'error-json'; value: unknown };

export interface ToolDefinition<TInput = any, TOutput = any> {
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput) => Promise<TOutput>;
  /** Optional: decouple what the model sees from what `execute` returns. */
  toModelOutput?: (output: TOutput) => ToolModelOutput;
}

