import { PrayerModerationScreen } from '@/components/moderasi/PrayerModerationScreen';

export const dynamic = 'force-dynamic';

/** Prayer moderation for Admins (PKS 3.7c); the Verifier's copy is /moderasi/doa. */
export default function AdminPrayersPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  return <PrayerModerationScreen basePath="/admin/doa" searchParams={searchParams} />;
}
