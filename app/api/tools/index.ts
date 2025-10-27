import { addResourceTool } from './addResource';
import { getInformationTool } from './getInformation';
import { getEventsTool } from './getEvents';

export const tools = {
  addResource: addResourceTool,
  getInformation: getInformationTool,
  getEvents: getEventsTool,
} as const;

export type { ToolDefinition } from './types';
