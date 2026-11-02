import { deadlineRequired, type CampaignKind } from '@/lib/campaign-kind';
import { endOfWibDay } from '@/lib/utils/date';
import { BENEFICIARY_COUNT_MAX, BENEFICIARY_DESCRIPTION_MAX, REGENCY_MAX } from '@/lib/campaign-location';
import { isProvinceCode } from '@/lib/indonesia-provinces';

/**
 * The parts of the Campaign form that the creation wizard and the Draft or
 * Rejected edit screen share (ticket 72), so a rule such as "story at least
 * 50 characters" is written once. Browser-safe: no Prisma values.
 */

export const TITLE_MAX = 200;
export const STORY_MIN = 50;
export const COVER_MAX_BYTES = 5 * 1024 * 1024;
/** What the server is told for `description`: the first words of the story. */
export const DESCRIPTION_LENGTH = 200;

export function titleError(title: string): string | undefined {
  if (!title.trim()) return 'Judul campaign harus diisi';
  if (title.length > TITLE_MAX) return `Judul maksimal ${TITLE_MAX} karakter`;
  return undefined;
}

export function storyError(story: string): string | undefined {
  if (!story.trim()) return 'Cerita campaign harus diisi';
  if (story.trim().length < STORY_MIN) return `Cerita campaign minimal ${STORY_MIN} karakter`;
  return undefined;
}

/** `kind` may be '' while none is chosen: then a deadline is asked for, as the wizard always did. */
export function deadlineError(kind: CampaignKind | '', deadline: string, now: Date = new Date()): string | undefined {
  if (!deadline) {
    return !kind || deadlineRequired(kind) ? 'Batas waktu harus dipilih' : undefined;
  }
  // The deadline is the end of the picked WIB day, so today is still valid.
  return endOfWibDay(deadline) <= now ? 'Batas waktu harus di masa depan' : undefined;
}

/** The refusal for a file that cannot be a cover image, or undefined when it can. */
export function coverFileError(file: { type: string; size: number }): string | undefined {
  if (!file.type.startsWith('image/')) return 'File harus berupa gambar';
  if (file.size > COVER_MAX_BYTES) return 'Ukuran file maksimal 5MB';
  return undefined;
}

/** "1500000" or "1.500.000" to "1.500.000"; digits only, '' when there are none. */
export function formatRupiahInput(value: string): string {
  const numbers = value.replace(/\D/g, '');
  if (!numbers) return '';
  return parseInt(numbers, 10).toLocaleString('id-ID');
}

export function parseRupiahInput(value: string): number {
  return parseInt(value.replace(/\D/g, ''), 10);
}

export const COVER_UPLOAD_ERROR = 'Gagal mengunggah gambar sampul. Silakan coba lagi.';

/** Uploads a cover image, returning its URL; throws the Indonesian refusal on failure. */
export async function uploadCoverImage(file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  let uploaded: { url?: string } | null = null;
  try {
    const res = await fetch('/api/upload', { method: 'POST', body });
    if (res.ok) uploaded = (await res.json()) as { url?: string };
  } catch {
    uploaded = null;
  }
  if (!uploaded?.url) throw new Error(COVER_UPLOAD_ERROR);
  return uploaded.url;
}

/** The content fields every Campaign form sends; the server judges the rest. */
export function contentPayload(form: { title: string; story: string; deadline: string }) {
  const story = form.story.trim();
  return {
    title: form.title.trim(),
    description: story.substring(0, DESCRIPTION_LENGTH),
    story,
    deadline: form.deadline ? endOfWibDay(form.deadline).toISOString() : undefined,
  };
}

/** The location and beneficiary inputs of the Campaign form (ticket 74), as typed. */
export interface LocationFormValues {
  province: string;
  regency: string;
  beneficiaryDescription: string;
  beneficiaryCount: string;
}

export const EMPTY_LOCATION_FORM: LocationFormValues = {
  province: '',
  regency: '',
  beneficiaryDescription: '',
  beneficiaryCount: '',
};

export type LocationFormErrors = Partial<Record<keyof LocationFormValues, string>>;

/** All four fields are optional; this only judges what was typed. */
export function locationErrors(values: LocationFormValues): LocationFormErrors {
  const errors: LocationFormErrors = {};
  if (values.province && !isProvinceCode(values.province)) errors.province = 'Provinsi tidak dikenal';
  if (values.regency.trim().length > REGENCY_MAX) errors.regency = `Kabupaten/kota maksimal ${REGENCY_MAX} karakter`;
  if (values.beneficiaryDescription.trim().length > BENEFICIARY_DESCRIPTION_MAX) {
    errors.beneficiaryDescription = `Penerima manfaat maksimal ${BENEFICIARY_DESCRIPTION_MAX} karakter`;
  }
  const count = values.beneficiaryCount.trim();
  if (count && (!/^\d+$/.test(count) || Number(count) <= 0 || Number(count) > BENEFICIARY_COUNT_MAX)) {
    errors.beneficiaryCount = 'Jumlah penerima manfaat harus bilangan bulat lebih dari 0';
  }
  return errors;
}

/** What the server is told: null for a blank field, so an edit can clear it. */
export function locationPayload(values: LocationFormValues) {
  const count = values.beneficiaryCount.trim();
  return {
    province: values.province || null,
    regency: values.regency.trim() || null,
    beneficiaryDescription: values.beneficiaryDescription.trim() || null,
    beneficiaryCount: count ? Number(count) : null,
  };
}
