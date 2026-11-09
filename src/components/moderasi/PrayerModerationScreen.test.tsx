import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prayer-moderation', () => ({ listPrayersForModeration: vi.fn() }));
vi.mock('./PrayerModerationList', () => ({
  PrayerModerationList: ({ filter, prayers }: { filter: string; prayers: unknown[] }) => (
    <div data-testid="list">{`${filter}:${prayers.length}`}</div>
  ),
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import { getServerSession } from '@/lib/auth';
import { listPrayersForModeration } from '@/lib/prayer-moderation';
import { PrayerModerationScreen } from './PrayerModerationScreen';

const list = listPrayersForModeration as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  list.mockResolvedValue({ prayers: [], total: 0 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PrayerModerationScreen', () => {
  it.each([
    ['nobody signed in', null],
    ['a signed-in user with no assignment', { user: { id: 'u', assignments: [] } }],
    ['someone with only the legacy ADMIN Role', { user: { id: 'u', role: 'ADMIN', assignments: [] } }],
  ])('404s for %s and reads no Prayer', async (_who, session) => {
    vi.mocked(getServerSession).mockResolvedValue(session as never);
    await expect(
      PrayerModerationScreen({ basePath: '/admin/doa', searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(list).not.toHaveBeenCalled();
  });

  it.each(['VERIFIER', 'ADMIN'])('shows the screen to a holder of %s, on the visible list by default', async (assignment) => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u', assignments: [assignment] } } as never);
    render(await PrayerModerationScreen({ basePath: '/admin/doa', searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId('list').textContent).toBe('visible:0');
    expect(list.mock.calls[0][1]).toMatchObject({ filter: 'visible' });
  });

  it('shows the hidden list when asked', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u', assignments: ['VERIFIER'] } } as never);
    render(await PrayerModerationScreen({ basePath: '/moderasi/doa', searchParams: Promise.resolve({ filter: 'hidden' }) }));
    expect(list.mock.calls[0][1]).toMatchObject({ filter: 'hidden' });
  });
});
