import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    paymentProviderSetting: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { prisma } from '@/lib/prisma';
import AdminPaymentProvidersPage from './page';

beforeEach(() => {
  vi.stubEnv('PAYMENT_PROVIDER', 'sumopod');
  vi.stubEnv('MOCK_MIDTRANS_SERVER_KEY', 'mock-key');
  vi.stubEnv('SUMOPOD_API_KEY', 'k');
  vi.stubEnv('SUMOPOD_WEBHOOK_SECRET', 'test-webhook-secret');
  vi.stubEnv('SUMOPOD_BASE_URL', 'https://api-pay.sumopod.com/api/v1');
  vi.mocked(prisma.paymentProviderSetting.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.paymentProviderSetting.findMany).mockResolvedValue([] as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

/**
 * prd-compliance 39: the Admin's view of which Payment Provider takes new
 * charges and through which methods. Credentials are never entered here.
 */
describe('AdminPaymentProvidersPage', () => {
  it('marks the environment default as active when nobody has chosen', async () => {
    render(await AdminPaymentProvidersPage());

    expect(screen.getByRole('heading', { name: 'sumopod' })).toBeTruthy();
    expect(screen.getByText('Aktif')).toBeTruthy();
    expect(screen.getByLabelText('sumopod QRIS')).toBeChecked();
    expect(screen.getByText(/memakai PAYMENT_PROVIDER dari environment/)).toBeTruthy();
  });

  it('lists a provider without credentials with the reason and no way to enable it', async () => {
    vi.stubEnv('SUMOPOD_API_KEY', '');
    vi.stubEnv('PAYMENT_PROVIDER', 'mock');

    render(await AdminPaymentProvidersPage());

    expect(screen.getByText(/sumopod belum dikonfigurasi/)).toBeTruthy();
    expect(screen.queryByLabelText('sumopod QRIS')).toBeNull();
    expect(screen.getAllByRole('button', { name: /aktifkan|simpan metode/i }).length).toBeGreaterThan(0);
  });

  it('has no field that takes a credential', async () => {
    const { container } = render(await AdminPaymentProvidersPage());

    expect(container.querySelectorAll('input[type="text"], input[type="password"], textarea')).toHaveLength(0);
  });
});
