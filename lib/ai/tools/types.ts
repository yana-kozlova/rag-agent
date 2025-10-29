import { z } from 'zod';

export interface ToolDefinition<TInput = any, TOutput = any> {
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput) => Promise<TOutput>;
}

export * from './add-resource';
export * from './get-information';
export * from './create-event';
