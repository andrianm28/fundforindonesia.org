import { PrayerModerationScreen } from '@/components/moderasi/PrayerModerationScreen';

export const dynamic = 'force-dynamic';

/** Prayer moderation for Verifiers (PKS 3.7c); the Admin's copy is /admin/doa. */
export default function ModerasiPrayersPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  return <PrayerModerationScreen basePath="/moderasi/doa" searchParams={searchParams} />;
}
