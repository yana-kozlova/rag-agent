// Information/Knowledge base tools
import { addResourceTool } from './information/add-resource';
import { getInformationTool } from './information/get-information';
import { forgetInformationTool } from './information/forget-information';

// Calendar/Events tools
import { getEventsTool } from './events/get-events';
import { optimizeScheduleTool } from './events/optimize-schedule';
import { deleteEventTool } from './events/delete-event';
import { scheduleEventTool } from './events/schedule-event';

export const tools = {
  addResource: addResourceTool,
  getInformation: getInformationTool,
  forgetInformation: forgetInformationTool,
  getEvents: getEventsTool,
  scheduleEvent: scheduleEventTool,
  optimizeSchedule: optimizeScheduleTool,
  deleteEvent: deleteEventTool,
} as const;

export type { ToolDefinition } from './types';
