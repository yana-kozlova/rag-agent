import { auth } from '@/app/api/auth/auth';
import Link from 'next/link';
import { CalendarsPanel } from './CalendarsPanel';
import { NotificationPreferences } from './NotificationPreferences';
import ClearDataPanel from './ClearDataPanel';
import { TelegramPanel } from './TelegramPanel';
import { ResponsePreferences } from './ResponsePreferences';
import Image from 'next/image';
import { getUserInitials } from '@/lib/utils';

export default async function SettingsPage() {
  const session = await auth();
  const user = session?.user;

  return (
    <div className="container mx-auto max-w-5xl p-4 md:p-6 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Profile &amp; Settings</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <section className="rounded-lg border border-base-300 bg-base-100 p-5">
          <div className="flex flex-col gap-4">
            <h2 className="text-[15px] font-semibold">Profile</h2>
            <div className="flex items-center gap-3">
              {user?.image ? (
                <div className="h-12 w-12 overflow-hidden rounded-full">
                  <Image
                    alt="avatar"
                    src={user.image}
                    width={48}
                    height={48}
                    sizes="48px"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-base-200 text-sm font-medium text-base-content/70">
                  {getUserInitials(user?.name)}
                </div>
              )}
              <div>
                <div className="font-medium">{user?.name || 'Unnamed'}</div>
                <div className="text-sm text-base-content/60">{user?.email || 'No email'}</div>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-base-content/70">Display name</label>
              <input className="input input-bordered" defaultValue={user?.name || ''} disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-base-content/70">Email</label>
              <input className="input input-bordered" defaultValue={user?.email || ''} disabled />
            </div>
            <div className="flex justify-end">
              <Link href="/api/auth/signout" className="btn btn-outline btn-sm">Sign out</Link>
            </div>
          </div>
        </section>

        <NotificationPreferences />
        <CalendarsPanel />
        <TelegramPanel />
        <ResponsePreferences />
        <ClearDataPanel />
      </div>
    </div>
  );
}
