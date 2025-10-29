import { z } from 'zod';
import { auth } from '../../../app/api/auth/auth';

export async function getSessionOrThrow() {
  const session = await auth();
  if (!session?.user?.id || !session.user.accessToken) {
    throw new Error('Unauthorized: Missing user ID or access token');
  }
  return session;
}

export function parseInputOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  return parsed.data as T;
}


