import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/failed-notifications', () => ({ listFailedNotifications: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { listFailedNotifications } from '@/lib/failed-notifications';
import AdminFailedNotificationsPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const AT = new Date('2026-11-10T03:00:00.000Z');
const mockList = listFailedNotifications as unknown as ReturnType<typeof vi.fn>;

describe('/admin/notifikasi-gagal', () => {
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
