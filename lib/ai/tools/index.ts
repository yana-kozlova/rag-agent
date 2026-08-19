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

// Wellbeing tracker tools
import { logWellbeingTool } from './wellbeing/log-wellbeing';
import { getWellbeingTool } from './wellbeing/get-wellbeing';

// Timeline — dates worth finding years later
import { rememberDateTool } from './timeline/remember-date';
import { getTimelineTool } from './timeline/get-timeline';

// Response preferences — standing instructions injected into every prompt
import { rememberPreferenceTool } from './directives/remember-preference';
import { forgetPreferenceTool } from './directives/forget-preference';

// Table tools
import { createTableTool } from './tables/create-table';
import { listTablesTool } from './tables/list-tables';
import { addTableRowsTool } from './tables/add-table-rows';
import { extractToTableTool } from './tables/extract-to-table';

// Quick actions — buttons that write a preset row with no model in the loop
import { createQuickActionTool } from './tables/create-quick-action';
import { deleteQuickActionTool } from './tables/delete-quick-action';

export const tools = {
  addResource: addResourceTool,
  getInformation: getInformationTool,
  forgetInformation: forgetInformationTool,
  analyzeFile: analyzeFileTool,
  getEvents: getEventsTool,
  scheduleEvent: scheduleEventTool,
  optimizeSchedule: optimizeScheduleTool,
  deleteEvent: deleteEventTool,
  logWellbeing: logWellbeingTool,
  getWellbeing: getWellbeingTool,
  rememberDate: rememberDateTool,
  getTimeline: getTimelineTool,
  rememberPreference: rememberPreferenceTool,
  forgetPreference: forgetPreferenceTool,
  createTable: createTableTool,
  listTables: listTablesTool,
  addTableRows: addTableRowsTool,
  extractToTable: extractToTableTool,
  createQuickAction: createQuickActionTool,
  deleteQuickAction: deleteQuickActionTool,
} as const;

export type { ToolDefinition } from './types';
