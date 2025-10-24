import { handlers } from '../auth';

export const runtime = 'nodejs';

export const { GET, POST } = handlers;

export const maxDuration = 300; // 5 minutes
