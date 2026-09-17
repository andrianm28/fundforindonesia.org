'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useCallback } from 'react';
import useSWR from 'swr';
import { getRelativeTimestamp } from '@/lib/utils/date';

interface NotificationItem {
  id: string;
  type: 'donation_confirmed' | 'campaign_update' | 'disbursement';
  title: string;
  message: string;
  isRead: boolean;
  link: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: NotificationItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function InboxPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const { data, isLoading, mutate } = useSWR<NotificationsResponse>(
    status === 'authenticated' ? '/api/notifications?limit=50' : null,
    fetcher,
    { revalidateOnFocus: true }
  );

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await fetch('/api/notifications/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      mutate();
    } catch {
      // silently fail
    }
  }, [mutate]);

  const handleNotificationClick = useCallback(
    async (notification: NotificationItem) => {
      // Mark as read if unread
      if (!notification.isRead) {
        try {
          await fetch('/api/notifications/read', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notificationIds: [notification.id] }),
          });
          mutate();
        } catch {
          // silently fail
        }
      }

      // Navigate to link if present
      if (notification.link) {
        router.push(notification.link);
      }
    },
    [router, mutate]
  );

  if (status === 'loading') {
    return <InboxSkeleton />;
  }

  if (status === 'unauthenticated') {
    return null;
  }

  const notifications = data?.notifications ?? [];
  const hasUnread = notifications.some((n) => !n.isRead);

  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-20">
      {/* Header */}
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-white text-lg font-semibold">Inbox</h1>
          {hasUnread && (
            <button
              onClick={handleMarkAllRead}
              className="text-white/90 text-xs font-medium hover:text-white transition-colors"
            >
              Tandai semua dibaca
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 mt-4">
        {isLoading ? (
          <NotificationListSkeleton />
        ) : notifications.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2">
            {notifications.map((notification) => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                onClick={() => handleNotificationClick(notification)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationCard({
  notification,
  onClick,
}: {
  notification: NotificationItem;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl shadow-sm p-4 transition-shadow hover:shadow-md ${
        notification.isRead ? 'bg-white' : 'bg-[#E3F2FD]'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Type icon */}
        <div className="flex-shrink-0 mt-0.5">
          <NotificationIcon type={notification.type} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p
              className={`text-sm line-clamp-1 ${
                notification.isRead
                  ? 'text-[#212121] font-medium'
                  : 'text-[#212121] font-semibold'
              }`}
            >
              {notification.title}
            </p>
            {/* Unread indicator dot */}
            {!notification.isRead && (
              <span className="flex-shrink-0 w-2 h-2 rounded-full bg-[#0073E6] mt-1.5" />
            )}
          </div>
          <p className="text-[#757575] text-xs mt-1 line-clamp-2">
            {notification.message}
          </p>
          <p className="text-[#9E9E9E] text-[10px] mt-1.5">
            {getRelativeTimestamp(new Date(notification.createdAt))}
          </p>
        </div>
      </div>
    </button>
  );
}

function NotificationIcon({ type }: { type: NotificationItem['type'] }) {
  const iconConfig = {
    donation_confirmed: {
      bg: 'bg-[#E8F5E9]',
      color: 'text-[#2E7D32]',
      path: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M5 13l4 4L19 7"
        />
      ),
    },
    campaign_update: {
      bg: 'bg-[#E3F2FD]',
      color: 'text-[#0073E6]',
      path: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      ),
    },
    disbursement: {
      bg: 'bg-[#FFF8E1]',
      color: 'text-[#F57F17]',
      path: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      ),
    },
  };

  const config = iconConfig[type] || iconConfig.campaign_update;

  return (
    <div
      className={`w-9 h-9 rounded-full flex items-center justify-center ${config.bg}`}
    >
      <svg
        className={`w-5 h-5 ${config.color}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        {config.path}
      </svg>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-20 h-20 rounded-full bg-[#E3F2FD] flex items-center justify-center mb-4">
        <svg
          className="w-10 h-10 text-[#0073E6]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
      </div>
      <p className="text-[#212121] text-base font-semibold text-center">
        Tidak ada notifikasi baru
      </p>
      <p className="text-[#757575] text-sm text-center mt-1">
        Notifikasi donasi dan update kampanye akan muncul di sini
      </p>
    </div>
  );
}

function InboxSkeleton() {
  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-20">
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <div className="h-5 w-16 bg-white/20 rounded" />
      </div>
      <div className="px-4 mt-4">
        <NotificationListSkeleton />
      </div>
    </div>
  );
}

function NotificationListSkeleton() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-[#E0E0E0] animate-pulse flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 bg-[#E0E0E0] rounded animate-pulse" />
              <div className="h-3 w-full bg-[#E0E0E0] rounded animate-pulse" />
              <div className="h-2.5 w-20 bg-[#E0E0E0] rounded animate-pulse" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
