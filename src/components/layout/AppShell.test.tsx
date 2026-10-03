import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockPathname = vi.hoisted(() => ({ value: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname.value,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));
vi.mock('./BottomNavBar', () => ({ default: () => null }));
vi.mock('./DesktopHeader', () => ({ default: () => null }));
vi.mock('./PageTransition', () => ({ PageTransition: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/hooks/useUnreadCount', () => ({ useUnreadCount: () => ({ unreadCount: 0 }) }));

import { AppShell } from './AppShell';

afterEach(() => cleanup());

// UAT round 1: /admin pages had a <main> inside AppShell's <main>.
describe('AppShell main landmark', () => {
  it('wraps an ordinary page in a main', () => {
    mockPathname.value = '/explore';
    render(<AppShell>isi</AppShell>);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('still wraps /administrasi in a main: it is not under /admin', () => {
    mockPathname.value = '/administrasi';
    render(<AppShell>isi</AppShell>);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it.each(['/admin', '/admin/payouts', '/moderasi/campaigns'])('does not add a main around %s, whose layout has its own', (path) => {
    mockPathname.value = path;
    render(<AppShell>isi</AppShell>);
    expect(screen.queryByRole('main')).toBeNull();
  });
});
