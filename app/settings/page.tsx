import { auth } from '@/app/api/auth/auth';
import Link from 'next/link';
import Image from 'next/image';

import { CalendarsPanel } from './CalendarsPanel';
import { NotificationPreferences } from './NotificationPreferences';
import ClearDataPanel from './ClearDataPanel';
import { TelegramPanel } from './TelegramPanel';
import { ResponsePreferences } from './ResponsePreferences';
import { SettingsNav } from './SettingsNav';
import { SettingsSection } from './ui';
import { getUserInitials } from '@/lib/utils';

/**
 * One column of sections, not a grid of cards.
 *
 * The two-column grid this replaces placed six panels of wildly different
 * heights by auto-flow, so Notifications — taller than the other five put
 * together — left a column of dead space beside it and every short panel below
 * hung off the bottom of whatever it happened to land next to. A single column
 * cannot do that, and the section list on the left buys back the scanability
 * the two columns were there for.
 *
 * Order is deliberate: identity, then what the assistant sends you, then how it
 * talks to you, then the two external hookups, then the destructive one last.
 */
export default async function SettingsPage() {
  const session = await auth();
  const user = session?.user;

  return (
    <div className="mx-auto w-full max-w-4xl px-0 py-2 md:py-4">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Profile &amp; Settings</h1>
        <p className="mt-1 text-sm text-base-content/60">
          Your account, what the assistant sends you, and how it answers.
        </p>
      </header>

      <div className="grid gap-8 xl:grid-cols-[9rem_minmax(0,1fr)]">
        {/* Below xl the page is narrow enough to scan by scrolling, and the
            chat rail has already taken the width this would need. */}
        <aside className="hidden xl:block">
          <SettingsNav />
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          <SettingsSection
            id="profile"
            title="Profile"
            description="Signed in with Google — your name and email come from that account."
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                {user?.image ? (
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full">
                    <Image
                      alt=""
                      src={user.image}
                      width={44}
                      height={44}
                      sizes="44px"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-base-200 text-sm font-medium text-base-content/70">
                    {getUserInitials(user?.name)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate font-medium">{user?.name || 'Unnamed'}</div>
                  <div className="truncate text-sm text-base-content/60">
                    {user?.email || 'No email'}
                  </div>
                </div>
              </div>
              <Link href="/api/auth/signout" className="btn btn-outline btn-sm">
                Sign out
              </Link>
            </div>
          </SettingsSection>

          <NotificationPreferences />
          <ResponsePreferences />
          <TelegramPanel />
          <CalendarsPanel />
          <ClearDataPanel />
        </div>
      </div>
    </div>
  );
}
