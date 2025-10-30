import { auth } from '@/app/api/auth/auth';
import Link from 'next/link';
import { ThemeSwitcher } from '@/app/components/theme/ThemeSwitcher';
import { NotificationsToggle } from '@/app/components/notifications/NotificationsToggle';
import { CalendarsPanel } from './CalendarsPanel';

export default async function SettingsPage() {
  const session = await auth();
  const user = session?.user;

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Profile & Settings</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="card bg-base-100 shadow">
          <div className="card-body gap-4">
            <h2 className="card-title">Profile</h2>
            <div className="flex items-center gap-3">
              <div className="avatar">
                <div className="w-12 rounded-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="avatar" src={user?.image || 'https://img.daisyui.com/images/profile/demo/kenobee@192.webp'} />
                </div>
              </div>
              <div>
                <div className="font-medium">{user?.name || 'Unnamed'}</div>
                <div className="text-sm opacity-70">{user?.email || 'No email'}</div>
              </div>
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text">Display name</span></label>
              <input className="input input-bordered" defaultValue={user?.name || ''} disabled />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text">Email</span></label>
              <input className="input input-bordered" defaultValue={user?.email || ''} disabled />
            </div>
            <div className="card-actions justify-end">
              <Link href="/api/auth/signout" className="btn btn-outline">Sign out</Link>
            </div>
          </div>
        </section>
 
        <section className="card bg-base-100 shadow">
          <div className="card-body gap-4">
            <h2 className="card-title">Settings</h2>
            <NotificationsToggle />
            <ThemeSwitcher />
            <div className="card-actions justify-end" />
          </div>
        </section>
      </div>

      <CalendarsPanel />
    </div>
  );
}


