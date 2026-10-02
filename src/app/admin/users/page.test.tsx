import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    status: 'authenticated',
    data: { user: { id: 'admin-1', assignments: ['ADMIN'] }, expires: '2099-01-01' },
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import AdminUsersPage from './page';

const USERS = [
  { id: 'admin-1', name: 'Saya', email: 'saya@test.com', createdAt: '2026-09-01T00:00:00.000Z', assignments: ['ADMIN'] },
  { id: 'u-1', name: 'Budi', email: 'budi@test.com', createdAt: '2026-09-01T00:00:00.000Z', assignments: ['VERIFIER'] },
  { id: 'u-2', name: 'Cinta', email: 'cinta@test.com', createdAt: '2026-09-01T00:00:00.000Z', assignments: [] },
];

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

let fetchMock: Mock;
let pendingRequests: unknown[];
let auditEntries: unknown[];

beforeEach(() => {
  pendingRequests = [];
  auditEntries = [];
  fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    if (url.startsWith('/api/admin/users?')) {
      return jsonResponse({ users: USERS, pagination: { page: 1, limit: 10, total: 3, totalPages: 1 } });
    }
    if (url === '/api/admin/users/u-1/assignments' && !init?.method) {
      return jsonResponse({ entries: auditEntries });
    }
    if (url === '/api/admin/assignment-grant-requests') {
      return jsonResponse({ requests: pendingRequests });
    }
    return jsonResponse({});
  });
  global.fetch = fetchMock as any;
});

afterEach(() => {
  cleanup();
});

/** Opens the page and returns the row of the user with this name. */
async function openAtRowOf(name: string) {
  render(<AdminUsersPage />);
  return (await screen.findByText(name)).closest('tr') as HTMLElement;
}

describe('AdminUsersPage', () => {
  it("shows each user's assignments", async () => {
    const budi = await openAtRowOf('Budi');

    expect((within(budi).getByLabelText('Verifier') as HTMLInputElement).checked).toBe(true);
    expect((within(budi).getByLabelText('Admin') as HTMLInputElement).checked).toBe(false);
  });

  // The Role hierarchy and the self-claimed verification are retired
  // (retire-role-hierarchy): nothing on the page edits a Role or shows the
  // user's own claim to be verified.
  it('offers no Role editor and no self-claimed verification', async () => {
    await openAtRowOf('Budi');

    expect(screen.queryByText(/Kreator Kampanye/)).toBeNull();
    expect(screen.queryByText(/Moderator/)).toBeNull();
    expect(screen.queryByText(/Ubah Role/)).toBeNull();
    expect(screen.queryByText('Klaim sendiri')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('grants VERIFIER immediately through the assignments route', async () => {
    const cinta = await openAtRowOf('Cinta');

    fireEvent.click(within(cinta).getByLabelText('Verifier'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/users/u-2/assignments', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ assignment: 'VERIFIER' }),
      })),
    );
    await waitFor(() => expect((within(cinta).getByLabelText('Verifier') as HTMLInputElement).checked).toBe(true));
  });

  it('revokes an assignment through the assignments route', async () => {
    const budi = await openAtRowOf('Budi');

    fireEvent.click(within(budi).getByLabelText('Verifier'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/users/u-1/assignments', expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ assignment: 'VERIFIER' }),
      })),
    );
    await waitFor(() => expect((within(budi).getByLabelText('Verifier') as HTMLInputElement).checked).toBe(false));
  });

  it('keeps the box as it was and shows why when the route refuses', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/users?')) {
        return jsonResponse({ users: USERS, pagination: { page: 1, limit: 10, total: 3, totalPages: 1 } });
      }
      if (url === '/api/admin/assignment-grant-requests') {
        return jsonResponse({ requests: pendingRequests });
      }
      return jsonResponse({ error: 'Cannot revoke the last ADMIN assignment' }, false);
    });
    const budi = await openAtRowOf('Budi');

    fireEvent.click(within(budi).getByLabelText('Verifier'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Cannot revoke the last ADMIN assignment'));
    expect((within(budi).getByLabelText('Verifier') as HTMLInputElement).checked).toBe(true);
    alertSpy.mockRestore();
  });

  // Nobody may revoke their own assignment, of either kind (ticket 07/20
  // decision); the page does not offer it, for VERIFIER or ADMIN alike.
  it('does not let anyone revoke their own assignment, of either kind', async () => {
    const self = await openAtRowOf('Saya');

    expect((within(self).getByLabelText('Admin') as HTMLInputElement).disabled).toBe(true);
    // "Saya" does not hold VERIFIER, so checking it would be a grant, not a
    // self-revoke, and stays enabled.
    expect((within(self).getByLabelText('Verifier') as HTMLInputElement).disabled).toBe(false);
  });

  // Granting ADMIN takes two Admins (ticket 07/20): checking the box opens a
  // pending request instead of granting it outright, and the box stays
  // unchecked until a different Admin confirms.
  it('proposes an ADMIN grant instead of granting it outright, and shows it pending', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/admin/users?')) {
        return jsonResponse({ users: USERS, pagination: { page: 1, limit: 10, total: 3, totalPages: 1 } });
      }
      if (url === '/api/admin/assignment-grant-requests') {
        return jsonResponse({ requests: pendingRequests });
      }
      if (url === '/api/admin/users/u-2/assignments' && init?.method === 'POST') {
        pendingRequests = [
          {
            id: 'req-9',
            userId: 'u-2',
            userName: 'Cinta',
            proposedById: 'admin-1',
            proposedByName: 'Saya',
            proposedAt: '2026-09-28T00:00:00.000Z',
            proposedReason: null,
          },
        ];
        return jsonResponse({ userId: 'u-2', assignment: 'ADMIN', action: 'PROPOSED', requestId: 'req-9' }, true);
      }
      return jsonResponse({});
    });
    const cinta = await openAtRowOf('Cinta');

    fireEvent.click(within(cinta).getByLabelText('Admin'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/users/u-2/assignments', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ assignment: 'ADMIN' }),
      })),
    );
    await waitFor(() => expect((within(cinta).getByLabelText('Admin') as HTMLInputElement).checked).toBe(false));
    expect(within(cinta).getByText(/menunggu konfirmasi/i)).toBeTruthy();
  });

  it('lets a different Admin confirm a pending ADMIN grant from the queue', async () => {
    pendingRequests = [
      {
        id: 'req-1',
        userId: 'u-2',
        userName: 'Cinta',
        proposedById: 'admin-2',
        proposedByName: 'Admin Lain',
        proposedAt: '2026-09-28T00:00:00.000Z',
        proposedReason: null,
      },
    ];
    render(<AdminUsersPage />);

    const confirmButton = await screen.findByRole('button', { name: /konfirmasi/i });
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/assignment-grant-requests/req-1/decision', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'confirm' }),
      })),
    );
  });

  it('offers withdraw, not confirm, to the Admin who proposed the pending grant', async () => {
    pendingRequests = [
      {
        id: 'req-1',
        userId: 'u-2',
        userName: 'Cinta',
        proposedById: 'admin-1',
        proposedByName: 'Saya',
        proposedAt: '2026-09-28T00:00:00.000Z',
        proposedReason: null,
      },
    ];
    render(<AdminUsersPage />);

    expect(await screen.findByRole('button', { name: /tarik/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /konfirmasi/i })).toBeNull();
  });

  it('opens the grant/revoke audit trail of a user from their row, in the order the route returns it', async () => {
    auditEntries = [
      { id: 'a-2', assignment: 'VERIFIER', action: 'REVOKED', actedById: 'admin-2', actedByName: 'Admin Dua', actedAt: '2026-09-30T00:00:00.000Z', reason: null },
      { id: 'a-1', assignment: 'VERIFIER', action: 'GRANTED', actedById: 'admin-1', actedByName: 'Saya', actedAt: '2026-09-29T00:00:00.000Z', reason: null },
    ];
    const budi = await openAtRowOf('Budi');

    fireEvent.click(within(budi).getByRole('button', { name: 'Riwayat' }));

    const list = await screen.findByRole('list', { name: /riwayat penugasan budi/i });
    const items = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('Dicabut');
    expect(items[0]).toContain('Admin Dua');
    expect(items[1]).toContain('Diberikan');
    expect(items[1]).toContain('Saya');
  });

  it('shows an empty state when the user has no audit entries', async () => {
    const budi = await openAtRowOf('Budi');
    fireEvent.click(within(budi).getByRole('button', { name: 'Riwayat' }));
    expect(await screen.findByText('Belum ada riwayat penugasan.')).toBeTruthy();
  });
});
