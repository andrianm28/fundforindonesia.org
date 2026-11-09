import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
);
vi.mock('next/navigation', () => ({ notFound }));
const resolveZakatCheckout = vi.hoisted(() => vi.fn());
vi.mock('@/lib/zakat', () => ({ resolveZakatCheckout }));

import ZakatPage from './page';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('/zakat', () => {
  it('is a 404 while the module is off (the default): the page asks for nothing else', async () => {
    resolveZakatCheckout.mockResolvedValue(null);

    await expect(ZakatPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('shows the calculator, the recipient, and what zakat here is not, once the module is on', async () => {
    resolveZakatCheckout.mockResolvedValue({
      nisabAmount: 85_000_000,
      recipientName: 'Yayasan Contoh Peduli',
      campaign: { slug: 'zakat-yayasan', title: 'Zakat melalui Yayasan Contoh' },
    });

    render(await ZakatPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Zakat' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Zakat penghasilan' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Zakat maal' })).toBeDefined();
    expect(screen.getAllByText(/Yayasan Contoh Peduli/).length).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(/bukan fatwa/i);
    expect(document.body.textContent).not.toMatch(/tersertifikasi|bersertifikat|sertifikasi syariah/i);
  });
});
