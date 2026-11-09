import type { Prisma } from '@/generated/prisma/client';
import { LEGAL_DOCS_VERSION } from './site-identity';

/**
 * Persetujuan Syarat Layanan dan Kebijakan Privasi (PKS Pasal 3.1, 3.8): satu
 * baris UserConsent per (pengguna, dokumen, versi), ditulis saat registrasi dan
 * saat pengguna Google pertama kali masuk, tidak pernah diubah.
 */
export const CONSENT_DOCUMENTS = ['TERMS', 'PRIVACY'] as const;

/** Data bersarang untuk `user.create`: persetujuan ditulis dalam transaksi yang sama dengan akunnya. */
export function nestedConsentCreate(at: Date = new Date()): Prisma.UserConsentCreateNestedManyWithoutUserInput {
  return {
    create: CONSENT_DOCUMENTS.map((document) => ({ document, version: LEGAL_DOCS_VERSION, acceptedAt: at })),
  };
}

type ConsentClient = {
  userConsent: {
    createMany(args: {
      data: Array<{ userId: string; document: (typeof CONSENT_DOCUMENTS)[number]; version: string; acceptedAt: Date }>;
      skipDuplicates: boolean;
    }): Promise<unknown>;
  };
};

/** Mencatat persetujuan versi sekarang untuk pengguna yang sudah ada; aman dipanggil ulang. */
export async function recordConsent(client: ConsentClient, userId: string, at: Date = new Date()): Promise<void> {
  await client.userConsent.createMany({
    data: CONSENT_DOCUMENTS.map((document) => ({ userId, document, version: LEGAL_DOCS_VERSION, acceptedAt: at })),
    skipDuplicates: true,
  });
}
