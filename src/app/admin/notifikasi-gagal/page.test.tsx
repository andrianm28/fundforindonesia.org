import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('@/lib/failed-notifications', () => ({ listFailedNotifications: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import { listFailedNotifications } from '@/lib/failed-notifications';
import { getServerSession } from '@/lib/auth';
import AdminFailedNotificationsPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const AT = new Date('2026-11-10T03:00:00.000Z');
const mockList = listFailedNotifications as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } } as never);
});

describe('/admin/notifikasi-gagal', () => {
  // Admin power comes only from the ADMIN assignment (ADR 0005). The /admin
  // layout already turns these viewers away; the page answers 404 on its own as
  // well, and reads nothing before it has.
  it.each([
    ['nobody signed in', null],
    ['a Verifier: the VERIFIER assignment is not Admin', { user: { id: 'ver-1', assignments: ['VERIFIER'] } }],
    ['someone with the ADMIN Role but not the ADMIN assignment', { user: { id: 'u-1', role: 'ADMIN', assignments: [] } }],
  ])('404s for %s, and lists nothing', async (_who, session) => {
    vi.mocked(getServerSession).mockResolvedValue(session as never);
    mockList.mockResolvedValue({ rows: [], counts: { pending: 0, dead: 0 } });

    await expect(AdminFailedNotificationsPage()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockList).not.toHaveBeenCalled();
  });

  it('labels attempts past the automatic limit instead of showing "7 / 5"', async () => {
    mockList.mockResolvedValue({
      counts: { pending: 0, dead: 1 },
      rows: [
        {
          id: 'n1',
          kind: 'receipt',
          context: '{"donationId":"d1"}',
          status: 'DEAD',
          attempts: 7,
          lastError: 'timeout',
          nextAttemptAt: AT,
          createdAt: AT,
          lastRetriedById: 'admin-1',
        },
      ],
    });

    render(await AdminFailedNotificationsPage());

    const row = screen.getAllByRole('row')[1];
    expect(within(row).queryByText('7 / 5')).not.toBeInTheDocument();
    expect(within(row).getByText('7 (batas otomatis 5, selebihnya kirim ulang Admin)')).toBeInTheDocument();
  });

  it('says the queue is empty when nothing waits', async () => {
    mockList.mockResolvedValue({ rows: [], counts: { pending: 0, dead: 0 } });

    render(await AdminFailedNotificationsPage());

    expect(screen.getByText(/Antrean kosong/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lists each row with its kind, subject ids, attempts and error, and a resend button, and no address', async () => {
    mockList.mockResolvedValue({
      counts: { pending: 1, dead: 1 },
      rows: [
        {
          id: 'n1',
          kind: 'receipt',
          context: '{"donationId":"d1"}',
          status: 'DEAD',
          attempts: 5,
          lastError: 'Error: 550 mailbox [email] unavailable',
          nextAttemptAt: AT,
          createdAt: AT,
          lastRetriedById: null,
        },
        {
          id: 'n2',
          kind: 'something_new',
          context: 'not json',
          status: 'PENDING',
          attempts: 2,
          lastError: 'timeout',
          nextAttemptAt: AT,
          createdAt: AT,
          lastRetriedById: 'admin-1',
        },
      ],
    });

    render(await AdminFailedNotificationsPage());

    expect(screen.getByText('1 gagal permanen, 1 masih dicoba ulang.')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Bukti donasi')).toBeInTheDocument();
    expect(within(rows[0]).getByText('donationId: d1')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Gagal permanen')).toBeInTheDocument();
    expect(within(rows[0]).getByText('5 / 5')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('button', { name: 'Kirim ulang' })).toBeInTheDocument();
    // A kind with no label, and a context that is not JSON, still show up.
    expect(within(rows[1]).getAllByText(/something_new/).length).toBeGreaterThan(0);
    expect(within(rows[1]).getByText('not json')).toBeInTheDocument();
  });
});
