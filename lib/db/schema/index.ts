// Export all your schema files here
export { resources } from "./resources";
export type { NewResourceParams } from "./resources";

export * from './user-tables';
export * from "./embeddings";
export * from "./auth";
export * from "./chat";
export * from "./push-subscriptions";
export * from "./sent-notifications";
export * from "./notification-queue";
// calendar schema removed; calendars stored on users.followed_calendars
