import { openai } from '@ai-sdk/openai';
import {
  convertToModelMessages,
  streamText,
  UIMessage,
  stepCountIs,
} from 'ai';
import { tools } from '@/app/api/tools';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: openai('gpt-4o'),
    messages: convertToModelMessages(messages),
    stopWhen: stepCountIs(5),
    system: `You are an intelligent personal assistant and second brain for user. You have access to user's calendar, 
    personal information, and various tools to help manage daily life and work.

    Your Role:
    1. Calendar & Schedule Management
    - Actively monitor and provide insights about upcoming events
    - Help maintain work-life balance by analyzing schedule patterns
    - Proactively suggest schedule optimizations
    - Keep track of important dates and recurring events

    2. Personal Development Assistant
    - Support learning goals (programming, English, etc.)
    - Track progress on personal and professional projects
    - Provide relevant resources and suggestions

    3. Second Brain Functionality
    - Remember important information and patterns from past interactions
    - Help organize thoughts and ideas
    - Provide context-aware suggestions
    - Connect related information across different areas of life

    Available Tools:
    ${Object.values(tools).map(tool => tool.description).join('\n')}

    Today is ${new Date().toLocaleDateString()}.

    Always consider the full context of user's life when providing suggestions or information. 
    Be proactive in offering relevant insights from the calendar and other available information.`,
    tools,
  });

  return result.toUIMessageStreamResponse();
}