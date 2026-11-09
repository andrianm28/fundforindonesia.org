import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const replace = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));

import ConsentPage from './page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replace.mockReset();
});

describe('consent page (Google first sign-in)', () => {
  it('does not post until both boxes are checked', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ConsentPage />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Syarat Layanan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/harus menyetujui/)).toBeInTheDocument();
  });

  it('posts both acceptances and leaves for the home page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<ConsentPage />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Syarat Layanan/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Kebijakan Privasi/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/user/consent');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ acceptTerms: true, acceptPrivacy: true });
  });
});
