// Export all your schema files here
export { resources } from "./resources";
export type { NewResourceParams } from "./resources";

// Add other named exports from other schema files as needed
export * from "./embeddings";
export * from "./auth";
export * from "./chat";
// calendar schema removed; calendars stored on users.followed_calendars
