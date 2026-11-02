import { z } from 'zod';
import { isProvinceCode, provinceName } from '@/lib/indonesia-provinces';

/**
 * A Campaign's structured location and beneficiaries (ticket 74, decision
 * C8). Every field is optional; a blank one means "none" (null), so a form
 * can clear a value it once set. Shared by POST /api/campaigns and PATCH
 * /api/campaigns/[slug]. Browser-safe.
 */
export const REGENCY_MAX = 100;
export const BENEFICIARY_DESCRIPTION_MAX = 200;
/** The largest value a Postgres INTEGER holds. */
export const BENEFICIARY_COUNT_MAX = 2_147_483_647;

/** Blank text is "not given". */
const blankToNull = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export const campaignLocationSchema = z.object({
  province: z.preprocess(
    blankToNull,
    z.string().refine(isProvinceCode, 'Provinsi tidak dikenal').nullable().optional(),
  ),
  regency: z.preprocess(
    blankToNull,
    z.string().trim().max(REGENCY_MAX, `Kabupaten/kota maksimal ${REGENCY_MAX} karakter`).nullable().optional(),
  ),
  beneficiaryDescription: z.preprocess(
    blankToNull,
    z.string().trim().max(BENEFICIARY_DESCRIPTION_MAX, `Penerima manfaat maksimal ${BENEFICIARY_DESCRIPTION_MAX} karakter`).nullable().optional(),
  ),
  beneficiaryCount: z
    .number()
    .int('Jumlah penerima manfaat harus bilangan bulat')
    .positive('Jumlah penerima manfaat harus lebih dari 0')
    .max(BENEFICIARY_COUNT_MAX, 'Jumlah penerima manfaat terlalu besar')
    .nullable()
    .optional(),
});

export type CampaignLocationFields = z.infer<typeof campaignLocationSchema>;

/**
 * "Kabupaten, Provinsi" for display; falls back to the free-text `location`
 * that predates the structured fields, or null when nothing is known.
 */
export function campaignLocationLabel(campaign: {
  province?: string | null;
  regency?: string | null;
  location?: string | null;
}): string | null {
  const parts = [campaign.regency?.trim(), provinceName(campaign.province)].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  return campaign.location?.trim() || null;
}
