// Information/Knowledge base tools
import { addResourceTool } from './information/add-resource';
import { getInformationTool } from './information/get-information';
import { forgetInformationTool } from './information/forget-information';

// Calendar/Events tools
import { getEventsTool } from './events/get-events';
import { createEventTool } from './events/create-event';

export const tools = {
  addResource: addResourceTool,
  getInformation: getInformationTool,
  forgetInformation: forgetInformationTool,
  getEvents: getEventsTool,
  createEvent: createEventTool,
} as const;

export type { ToolDefinition } from './types';
