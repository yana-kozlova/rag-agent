import { addResourceTool } from './addResource';
import { getInformationTool } from './getInformation';

export const tools = {
  addResource: addResourceTool,
  getInformation: getInformationTool,
} as const;

export type { ToolDefinition } from './types';
