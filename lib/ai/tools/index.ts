// Information/Knowledge base tools
import { addResourceTool } from './information/add-resource';
import { getInformationTool } from './information/get-information';
import { forgetInformationTool } from './information/forget-information';
import { analyzeFileTool } from './information/analyze-file';

// Calendar/Events tools
import { getEventsTool } from './events/get-events';
import { optimizeScheduleTool } from './events/optimize-schedule';
import { deleteEventTool } from './events/delete-event';
import { scheduleEventTool } from './events/schedule-event';

// Table tools
import { createTableTool } from './tables/create-table';
import { listTablesTool } from './tables/list-tables';
import { addTableRowsTool } from './tables/add-table-rows';

export const tools = {
  addResource: addResourceTool,
  getInformation: getInformationTool,
  forgetInformation: forgetInformationTool,
  analyzeFile: analyzeFileTool,
  getEvents: getEventsTool,
  scheduleEvent: scheduleEventTool,
  optimizeSchedule: optimizeScheduleTool,
  deleteEvent: deleteEventTool,
  createTable: createTableTool,
  listTables: listTablesTool,
  addTableRows: addTableRowsTool,
} as const;

export type { ToolDefinition } from './types';
