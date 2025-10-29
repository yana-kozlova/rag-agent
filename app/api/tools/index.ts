import { addResourceTool } from './addResource';
import { getInformationTool } from './getInformation';
import { getEventsTool } from './getEvents';
import { createEventTool } from './createEvent';

export const tools = {
  addResource: addResourceTool,
  getInformation: getInformationTool,
  getEvents: getEventsTool,
  createEvent: createEventTool,
} as const;

export type { ToolDefinition } from './types';
