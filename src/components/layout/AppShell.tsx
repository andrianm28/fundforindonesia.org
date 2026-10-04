'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import BottomNavBar from './BottomNavBar';
import DesktopHeader from './DesktopHeader';
import { PageTransition } from './PageTransition';
import { useUnreadCount } from '@/lib/hooks/useUnreadCount';
import { User } from '@/types';
import { staffEntryLinks } from '@/lib/staff-entry-links';

type TabId = 'home' | 'galang-dana' | 'donasi-saya' | 'inbox' | 'akun';

function getActiveTab(pathname: string): TabId {
  if (pathname.startsWith('/campaign/create') || pathname.startsWith('/galang-dana')) {
    return 'galang-dana';
  }
  if (pathname.startsWith('/donasi-saya')) {
    return 'donasi-saya';
  }
  if (pathname.startsWith('/inbox')) {
    return 'inbox';
  }
  if (pathname.startsWith('/akun')) {
    return 'akun';
  }
  return 'home';
}

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { unreadCount } = useUnreadCount();
  const activeTab = getActiveTab(pathname);
  // /admin and /moderasi layouts render their own <main>; a second one here
  // would nest landmarks (UAT round 1), so this wrapper steps down to a div.
  const ownsMain = pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/moderasi' ||
    pathname.startsWith('/moderasi/');
  const Content = ownsMain ? 'div' : 'main';

  // Map session user to the User shape expected by DesktopHeader
  const user: User | null = session?.user
    ? {
        id: session.user.id,
        email: session.user.email ?? '',
        name: session.user.name ?? '',
        avatar: session.user.image ?? null,
        donationBalance: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    : null;

  const handleSearch = (query: string) => {
    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <>
      {/* Desktop Header - hidden on mobile/tablet, visible on lg+ */}
      <DesktopHeader
        user={user}
        notificationCount={unreadCount}
        staffLinks={staffEntryLinks(session?.user?.assignments)}
        onSearch={handleSearch}
      />

      {/* Main content area with padding for fixed navigation */}
      <Content className="pb-16 lg:pb-0 lg:pt-16">
        <PageTransition direction="up">
          {children}
        </PageTransition>
      </Content>

      {/* Bottom Nav - visible on mobile/tablet, hidden on lg+ */}
      <BottomNavBar activeTab={activeTab} unreadCount={unreadCount} />
    </>
  );
}
