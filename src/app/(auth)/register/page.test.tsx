import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import RegisterPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fill() {
  fireEvent.change(screen.getByLabelText(/Nama Lengkap/), { target: { value: 'Budi' } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'budi@example.com' } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: '12345678' } });
}

describe('RegisterPage consent and claims (audit L3, L7; PKS 3.1)', () => {
  it('has two required consent checkboxes linking the Terms and Privacy policy', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('checkbox', { name: /Syarat Layanan/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Kebijakan Privasi/ })).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'Syarat Layanan' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Kebijakan Privasi' })).toHaveAttribute('href', '/privacy');
  });

  it('does not submit without both checkboxes', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage />);
    fill();
    fireEvent.click(screen.getByRole('checkbox', { name: /Syarat Layanan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Daftar' }));

    expect(await screen.findByText('Anda harus menyetujui Kebijakan Privasi')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends WhatsApp, profile type and both acceptances', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage />);
    fill();
    fireEvent.change(screen.getByLabelText(/WhatsApp/), { target: { value: '0812 3456 7890' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Lembaga' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Syarat Layanan/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Kebijakan Privasi/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Daftar' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      whatsapp: '0812 3456 7890',
      profileType: 'ORGANISATION',
      acceptTerms: true,
      acceptPrivacy: true,
    });
  });

  it('makes no claim about millions of members', () => {
    render(<RegisterPage />);
    expect(document.body.textContent).not.toMatch(/jutaan/);
  });
});
