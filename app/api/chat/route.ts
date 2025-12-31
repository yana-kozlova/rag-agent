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
import { saveUserMessageIfImportant } from '@/lib/middleware/save-user-message';

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();

    // Process messages - detect hidden resourceIds marker and add technical info
    const processedMessages = messages.map((m: any, idx: number) => {
      // Check if this is the last user message and contains resourceIds marker
      if (m.role === 'user' && idx === messages.length - 1) {
        // Get current message content
        let currentContent = '';
        if (typeof m.content === 'string') {
          currentContent = m.content;
        } else if (Array.isArray(m.parts)) {
          const textPart = m.parts.find((p: any) => p?.type === 'text');
          currentContent = textPart?.text || '';
        } else if (typeof m.text === 'string') {
          currentContent = m.text;
        }
        
        // Check for hidden resourceIds marker: [RESOURCE_IDS:...]
        const markerMatch = currentContent.match(/\u200B\u200B\[RESOURCE_IDS:([^\]]+)\]\u200B\u200B/);
        if (markerMatch) {
          const resourceIds = markerMatch[1].split(',');
          const resourceIdsList = resourceIds.join(', ');
          const fileInfo = `[FILES_UPLOADED] ${resourceIds.length} file(s) have been uploaded to the knowledge base. Resource IDs: ${resourceIdsList}. Use analyzeFile with these resourceIds directly - DO NOT use getInformation. The files are already saved and available.`;
          
          // Remove marker and add technical info
          const contentWithoutMarker = currentContent.replace(/\u200B\u200B\[RESOURCE_IDS:[^\]]+\]\u200B\u200B/, '').trim();
          const enhancedContent = contentWithoutMarker 
            ? `${contentWithoutMarker}\n\n${fileInfo}`
            : fileInfo;
          
          // Return message with enhanced content
          return {
            ...m,
            content: enhancedContent,
          };
        }
      }
      return m;
    });

    // Middleware: Automatically save the last user message if it contains important information
    const lastUserMessage = processedMessages
      .filter(m => m.role === 'user')
      .pop();
    if (lastUserMessage) {
      // UIMessage can have content as string or parts array
      let textContent: string | undefined;
      if (typeof (lastUserMessage as any).content === 'string') {
        textContent = (lastUserMessage as any).content;
      } else if (Array.isArray((lastUserMessage as any).parts)) {
        const textPart = (lastUserMessage as any).parts.find((p: any) => p?.type === 'text');
        textContent = textPart?.text;
      } else if (typeof (lastUserMessage as any).text === 'string') {
        textContent = (lastUserMessage as any).text;
      }
      
      // Remove technical info before saving to messages table
      if (textContent) {
        const textForSaving = textContent.replace(/\n\n\[FILES_UPLOADED\].*$/s, '').trim();
        // Fire and forget - don't block the response
        saveUserMessageIfImportant(textForSaving).catch(err => {
          console.error('Failed to save user message:', err);
        });
      }
    }

    const modelName = env.AI_CHAT_MODEL || 'gpt-4o-mini';
    const toolSteps = env.AI_TOOL_STEPS ?? 5;
    const result = streamText({
      model: openai(modelName),
      messages: convertToModelMessages(processedMessages),
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