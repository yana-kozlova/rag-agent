import { customType } from 'drizzle-orm/pg-core';

/**
 * Custom jsonb column type that works correctly with postgres-js.
 *
 * drizzle-orm's built-in `jsonb` type calls JSON.stringify in `toDriver`,
 * and postgres-js ALSO serializes values for jsonb columns, causing
 * double-encoding (values end up stored as JSON strings instead of
 * JSON objects/arrays). This custom type bypasses drizzle's stringify
 * and lets postgres-js handle serialization, producing correct jsonb.
 */
export const jsonb = customType<{ data: unknown; driverData: unknown }>({
  dataType() {
    return 'jsonb';
  },
  toDriver(value) {
    return value as unknown;
  },
});
