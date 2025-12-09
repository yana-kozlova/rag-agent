import { z } from 'zod';

export interface ToolDefinition<TInput = any, TOutput = any> {
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput) => Promise<TOutput>;
}

export * from './information/add-resource';
export * from './information/get-information';
export * from './events/create-event';
