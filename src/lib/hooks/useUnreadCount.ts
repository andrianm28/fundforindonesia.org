import useSWR from 'swr';
import { useSession } from 'next-auth/react';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function useUnreadCount() {
  const { status } = useSession();

  const { data, mutate } = useSWR(
    status === 'authenticated' ? '/api/notifications/unread-count' : null,
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: true }
  );

  // IMPORTANT: existing API returns { count }, NOT { unreadCount }
  return { unreadCount: data?.count ?? 0, refreshCount: mutate };
}
