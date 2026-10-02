import { prisma } from '@/lib/prisma';
import { AdminPaymentProviderForm } from '@/components/admin/AdminPaymentProviderForm';
import {
  getPaymentProvider,
  PaymentProviderNotConfiguredError,
} from '@/lib/payments';
import { PAYMENT_PROVIDER_NAMES } from '@/lib/payments/provider-names';
import { paymentProviderProductionRefusal } from '@/lib/payments/production-readiness';
import { providerSupportedMethods, resolveActivePaymentProvider } from '@/lib/payments/active-provider';
import type { PaymentMethod } from '@/lib/payments';

export const dynamic = 'force-dynamic';

/**
 * Where an Admin switches Payment Providers and their methods on without a
 * deploy (prd-compliance 39, PRD FFI-18; CONTEXT.md, Payment Provider). Each
 * registered provider gets one form that posts to POST
 * /api/admin/payment-providers; this page adds no route of its own.
 *
 * What it shows is what the server can actually do: a provider whose
 * credentials are not in this deployment's environment, or that may not take
 * money in production (the mock, a sandbox), is listed with the reason and no
 * way to switch it on. Credentials are never entered here (ADR 0011: one
 * merchant account per platform, keys in the environment only).
 */

const METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer_va: 'Virtual Account (transfer bank)',
  qris_redirect: 'QRIS',
  ewallet_redirect: 'E-wallet',
};

export default async function AdminPaymentProvidersPage() {
  let activeName: string | null = null;
  let activeMethods: readonly PaymentMethod[] = [];
  let activeProblem: string | null = null;
  try {
    const active = await resolveActivePaymentProvider(prisma);
    activeName = active.provider.name;
    activeMethods = active.enabledMethods;
  } catch (error) {
    if (!(error instanceof PaymentProviderNotConfiguredError)) throw error;
    activeProblem = error.message;
  }

  const history = await prisma.paymentProviderSetting.findMany({
    orderBy: { setAt: 'desc' },
    take: 1,
    include: { setBy: { select: { name: true } } },
  });
  const last = history[0];

  const rows = PAYMENT_PROVIDER_NAMES.map((name) => {
    let methods: PaymentMethod[] = [];
    let unavailableReason: string | null = null;
    try {
      methods = [...providerSupportedMethods(getPaymentProvider(name))];
      if (process.env.NODE_ENV === 'production') {
        unavailableReason = paymentProviderProductionRefusal(name);
      }
    } catch (error) {
      if (!(error instanceof PaymentProviderNotConfiguredError)) throw error;
      unavailableReason = `${name} belum dikonfigurasi di server ini. Kredensialnya diisi lewat environment variable, bukan dari halaman ini.`;
    }
    return { name, methods, unavailableReason };
  });

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Penyedia Pembayaran</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pilih Payment Provider yang menagih Payment baru dan metode yang ditawarkan ke Donor. Perubahan hanya
          berlaku untuk Payment baru; Payment yang sudah dibuat tetap diselesaikan oleh penyedianya sendiri. Akun
          merchant milik platform ini dan tidak dipakai bersama platform lain (ADR 0011).
        </p>
        {activeProblem ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            Penyedia yang berlaku saat ini tidak bisa dipakai: {activeProblem}
          </p>
        ) : (
          <p className="mt-2 text-xs text-gray-400">
            {last
              ? `Terakhir diubah oleh ${last.setBy?.name ?? 'Admin'} pada ${new Date(last.setAt).toLocaleString('id-ID', {
                  dateStyle: 'long',
                  timeStyle: 'short',
                  timeZone: 'Asia/Jakarta',
                })} WIB.`
              : 'Belum pernah diubah; memakai PAYMENT_PROVIDER dari environment.'}
          </p>
        )}
      </div>

      <div className="space-y-4">
        {rows.map((row) => (
          <div key={row.name} className="rounded-xl border border-gray-200 bg-white p-4">
            <AdminPaymentProviderForm
              provider={row.name}
              methods={row.methods.map((value) => ({ value, label: METHOD_LABELS[value] }))}
              enabled={row.name === activeName ? [...activeMethods] : []}
              active={row.name === activeName}
              unavailableReason={row.unavailableReason}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
