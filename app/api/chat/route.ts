import { openai } from '@ai-sdk/openai';
import {
  convertToModelMessages,
  streamText,
  UIMessage,
  stepCountIs,
} from 'ai';
import { tools } from '@/lib/ai/tools';
import { env } from '@/lib/env.mjs';
import { SYSTEM_PROMPT } from '@/app/prompts/system';

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();

    const modelName = env.AI_CHAT_MODEL || 'gpt-4o-mini';
    const toolSteps = env.AI_TOOL_STEPS ?? 5;
    const result = streamText({
      model: openai(modelName),
      messages: convertToModelMessages(messages),
      stopWhen: stepCountIs(toolSteps),
      system: SYSTEM_PROMPT.replace('{TOOLS}', Object.values(tools).map(t => t.description).join('\n')).replace('{TODAY}', new Date().toLocaleDateString()),
      tools,
      abortSignal: (req as any).signal,
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.error(err);
    return new Response('Internal Server Error', { status: 500 });
  }
}