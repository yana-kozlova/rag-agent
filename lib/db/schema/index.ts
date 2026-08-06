// Export all your schema files here
export { resources } from "./resources";
export type { NewResourceParams } from "./resources";

export * from './user-tables';
export * from "./embeddings";
export * from "./auth";
export * from "./chat";
// push_subscriptions removed with Web Push; notifications go to Telegram.
export * from "./sent-notifications";
export * from "./notification-queue";
export * from "./entities";
// calendar schema removed; calendars stored on users.followed_calendars
