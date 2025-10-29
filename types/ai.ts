export type TextPart = { type: 'text'; text: string };
export type ToolPart = { type: string; state?: string; input?: any; output?: any };
export type ChatPart = TextPart | ToolPart;

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts?: ChatPart[];
  createdAt?: string | Date;
};


