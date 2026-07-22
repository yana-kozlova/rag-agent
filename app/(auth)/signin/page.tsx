'use client';

import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';

export default function SignInPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') {
      router.push('/');
    }
  }, [status, router]);

  if (status === 'loading' || status === 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-base-300 border-t-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-content">
            <Sparkles className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-base-content">Welcome back</h1>
          <p className="mt-1.5 text-sm text-base-content/60">Sign in to your AI assistant</p>
        </div>

        <button
          className="flex w-full items-center justify-center gap-2.5 rounded-md border border-base-300 bg-base-100 px-4 py-2.5 text-sm font-medium text-base-content transition-colors hover:bg-base-200"
          onClick={() => signIn('google', { callbackUrl: '/' })}
        >
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M23.06 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h6.2a5.3 5.3 0 0 1-2.3 3.48v2.88h3.72c2.18-2 3.44-4.96 3.44-8.37z"/>
            <path fill="#34A853" d="M12 24c3.1 0 5.7-1.03 7.6-2.78l-3.72-2.88c-1.03.69-2.35 1.1-3.88 1.1-2.98 0-5.5-2.01-6.4-4.72H1.75v2.97A11.99 11.99 0 0 0 12 24z"/>
            <path fill="#FBBC05" d="M5.6 14.72a7.2 7.2 0 0 1 0-4.44V7.31H1.75a12 12 0 0 0 0 10.38l3.85-2.97z"/>
            <path fill="#EA4335" d="M12 4.76c1.68 0 3.2.58 4.4 1.72l3.3-3.3C17.7 1.2 15.1 0 12 0 7.3 0 3.25 2.7 1.75 6.62l3.85 2.97C6.5 6.87 9.02 4.76 12 4.76z"/>
          </svg>
          Continue with Google
        </button>

        <p className="mt-6 text-center text-xs text-base-content/40">
          Google Calendar &amp; Drive access powers your assistant.
        </p>
      </div>
    </div>
  );
}
