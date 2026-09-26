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
];

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/admin/users?')) {
      return jsonResponse({ users: USERS, pagination: { page: 1, limit: 10, total: 2, totalPages: 1 } });
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

  it('grants an assignment through the assignments route', async () => {
    const budi = await openAtRowOf('Budi');

    fireEvent.click(within(budi).getByLabelText('Admin'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/users/u-1/assignments', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ assignment: 'ADMIN' }),
      })),
    );
    await waitFor(() => expect((within(budi).getByLabelText('Admin') as HTMLInputElement).checked).toBe(true));
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
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/admin/users?')
        ? jsonResponse({ users: USERS, pagination: { page: 1, limit: 10, total: 2, totalPages: 1 } })
        : jsonResponse({ error: 'Cannot revoke the last ADMIN assignment' }, false),
    );
    const budi = await openAtRowOf('Budi');

    fireEvent.click(within(budi).getByLabelText('Verifier'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Cannot revoke the last ADMIN assignment'));
    expect((within(budi).getByLabelText('Verifier') as HTMLInputElement).checked).toBe(true);
    alertSpy.mockRestore();
  });

  // The assignments route refuses an Admin revoking their own ADMIN
  // assignment; the page does not offer it.
  it("does not let the Admin revoke their own ADMIN assignment", async () => {
    const self = await openAtRowOf('Saya');

    expect((within(self).getByLabelText('Admin') as HTMLInputElement).disabled).toBe(true);
    expect((within(self).getByLabelText('Verifier') as HTMLInputElement).disabled).toBe(false);
  });
});
