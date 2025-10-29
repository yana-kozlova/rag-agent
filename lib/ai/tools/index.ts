import { addResourceTool } from './add-resource';
import { getInformationTool } from './get-information';
import { getEventsTool } from './get-events';
import { createEventTool } from './create-event';

export const tools = {
  addResource: addResourceTool,
  getInformation: getInformationTool,
  getEvents: getEventsTool,
  createEvent: createEventTool,
} as const;

export type { ToolDefinition } from './types';
