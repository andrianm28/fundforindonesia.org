import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnonymiseDonationsSection } from './AnonymiseDonationsSection';

/**
 * Account settings' half of Donor anonymisation (ticket 36; PRD FFI-16): a
 * destructive, irreversible request, so nothing is sent until the Donor has
 * read what it costs and confirmed.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AnonymiseDonationsSection', () => {
  it('states the cost before asking, and sends nothing until confirmed', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<AnonymiseDonationsSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Hapus identitas dari donasi saya' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/tidak dapat dibatalkan/i)).toBeTruthy();
    expect(screen.getByText(/tidak dapat di-refund lewat sistem/i)).toBeTruthy();
    expect(screen.getByText(/akun Anda tidak dihapus/i)).toBeTruthy();
  });

  it('posts to the anonymise route on confirm and reports how many Donations changed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ status: 'anonymised', anonymisedCount: 3 }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<AnonymiseDonationsSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Hapus identitas dari donasi saya' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ya, anonimkan' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/user/anonymise-donations', { method: 'POST' });
    await waitFor(() => expect(screen.getByText(/3 donasi/)).toBeTruthy());
  });

  it('says so when there was nothing left to anonymise', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'already-anonymised', anonymisedCount: 0 }) }),
    );
    render(<AnonymiseDonationsSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Hapus identitas dari donasi saya' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ya, anonimkan' }));

    await waitFor(() => expect(screen.getByText(/tidak ada donasi/i)).toBeTruthy());
  });

  it('shows the refusal, for instance an open Refund', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Ada Refund yang belum selesai' }) }),
    );
    render(<AnonymiseDonationsSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Hapus identitas dari donasi saya' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ya, anonimkan' }));

    await waitFor(() => expect(screen.getByText('Ada Refund yang belum selesai')).toBeTruthy());
  });
});
