import { NextResponse } from 'next/server';
import { env } from '@/lib/env.mjs';

export const runtime = 'nodejs';

export async function GET() {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
  
  if (!publicKey) {
    return NextResponse.json(
      { ok: false, error: 'VAPID public key not configured' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, publicKey });
}

