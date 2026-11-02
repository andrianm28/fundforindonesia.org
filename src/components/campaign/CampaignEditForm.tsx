'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CampaignKindField } from '@/components/campaign/CampaignKindField';
import { CampaignDeadlineField } from '@/components/campaign/CampaignDeadlineField';
import { CoverImageField } from '@/components/campaign/CoverImageField';
import { CampaignStoryField } from '@/components/campaign/CampaignStoryField';
import { CollectingEntityField, type SponsorOptions } from '@/components/campaign/CollectingEntityField';
import { CampaignLocationFields } from '@/components/campaign/CampaignLocationFields';
import type { CampaignKind } from '@/lib/campaign-kind';
import {
  contentPayload,
  deadlineError,
  locationErrors,
  locationPayload,
  storyError,
  titleError,
  TITLE_MAX,
  uploadCoverImage,
  type LocationFormErrors,
  type LocationFormValues,
} from '@/lib/campaign-form';
import { saveCampaignEdit } from '@/lib/fundraiser-requests';
import { submitToVerifier } from '@/lib/verification-submission';
import { formatRupiah } from '@/lib/utils/currency';

export interface CampaignEditInitial extends LocationFormValues {
  kind: CampaignKind;
  title: string;
  story: string;
  /** The WIB calendar date `YYYY-MM-DD`, or '' when there is no deadline. */
  deadline: string;
  coverImage: string;
  collectingEntityId: string;
}

interface Errors extends LocationFormErrors {
  kind?: string;
  title?: string;
  deadline?: string;
  coverImage?: string;
  story?: string;
  collectingEntityId?: string;
}

/**
 * The edit screen of a Draft or Rejected Campaign (ticket 72): the same
 * fields, components and rules as the creation wizard (campaign-form.ts),
 * saved through PATCH /api/campaigns/[slug]. Target and Category are shown
 * but not editable: that route does not take them before approval, and after
 * it they change through a change request or an Admin.
 */
export function CampaignEditForm({
  slug,
  initial,
  targetAmount,
  categoryName,
}: {
  slug: string;
  initial: CampaignEditInitial;
  targetAmount: number;
  categoryName: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [newCover, setNewCover] = useState<{ file: File; preview: string } | null>(null);
  const [coverCleared, setCoverCleared] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [sponsorOptions, setSponsorOptions] = useState<SponsorOptions | null>(null);
  const [pending, setPending] = useState<'save' | 'submit' | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/partner-organisations/sponsors')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((options: SponsorOptions) => {
        if (!cancelled) setSponsorOptions(options);
      })
      .catch(() => {
        if (!cancelled) setSponsorOptions({ own: null, sponsors: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const preview = newCover?.preview ?? (coverCleared ? '' : initial.coverImage);
  const mustPickSponsor = !!sponsorOptions && !sponsorOptions.own && sponsorOptions.sponsors.length > 0;

  function validate(): boolean {
    const next: Errors = {};
    const title = titleError(form.title);
    if (title) next.title = title;
    const story = storyError(form.story);
    if (story) next.story = story;
    const deadline = deadlineError(form.kind, form.deadline);
    if (deadline) next.deadline = deadline;
    if (!form.kind) next.kind = 'Kind harus dipilih';
    if (!preview) next.coverImage = 'Gambar cover harus diunggah';
    if (mustPickSponsor && !form.collectingEntityId) {
      next.collectingEntityId = 'Pilih Partner Organisation yang menaungi Campaign ini';
    }
    Object.assign(next, locationErrors(form));
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save(andSubmit: boolean) {
    setMessage('');
    if (!validate()) return;
    setPending(andSubmit ? 'submit' : 'save');
    let saved = false;
    try {
      const coverImage = newCover ? await uploadCoverImage(newCover.file) : initial.coverImage;
      const content = contentPayload(form);
      const refused = await saveCampaignEdit(slug, {
        ...content,
        // null, not undefined: an emptied deadline must clear it (wakaf only).
        deadline: content.deadline ?? null,
        coverImage,
        kind: form.kind,
        ...locationPayload(form),
        // An organisation's own account gets its organisation on the server.
        ...(!sponsorOptions?.own && form.collectingEntityId && { collectingEntityId: form.collectingEntityId }),
      });
      if (refused) throw new Error(refused);
      saved = true;
      if (andSubmit) {
        const notSubmitted = await submitToVerifier(slug);
        if (notSubmitted) throw new Error(notSubmitted);
      }
      router.push('/akun/kampanye-saya');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Terjadi kesalahan. Silakan coba lagi.';
      setMessage(saved ? `Perubahan tersimpan, tetapi belum diajukan: ${reason}` : reason);
      if (saved) router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-5 bg-white rounded-lg shadow-card p-6">
      {message && (
        <div role="alert" className="p-3 bg-danger/10 border border-danger/20 rounded-md">
          <p className="text-sm text-danger">{message}</p>
        </div>
      )}

      <CampaignKindField
        value={form.kind}
        error={errors.kind}
        onChange={(kind) => setForm((prev) => ({ ...prev, kind: kind as CampaignKind }))}
      />

      <Input
        id="campaign-title"
        label="Judul Campaign"
        value={form.title}
        onChange={(title) => setForm((prev) => ({ ...prev, title }))}
        error={errors.title}
        required
        helperText={`${form.title.length}/${TITLE_MAX} karakter`}
      />

      <div className="rounded-md bg-bg-secondary p-3 text-sm space-y-1">
        <p data-testid="edit-target">
          <span className="text-text-secondary">Target Donasi: </span>
          <span className="font-medium text-text">{formatRupiah(targetAmount)}</span>
        </p>
        <p data-testid="edit-category">
          <span className="text-text-secondary">Kategori: </span>
          <span className="font-medium text-text">{categoryName}</span>
        </p>
        <p className="text-xs text-text-secondary">
          Target dan kategori tidak dapat diubah dari sini. Setelah Campaign aktif, perubahan target dan tenggat
          diajukan ke Verifier.
        </p>
      </div>

      <CampaignDeadlineField
        kind={form.kind}
        value={form.deadline}
        error={errors.deadline}
        onChange={(deadline) => setForm((prev) => ({ ...prev, deadline }))}
      />

      <CollectingEntityField
        options={sponsorOptions}
        value={form.collectingEntityId}
        error={errors.collectingEntityId}
        onChange={(collectingEntityId) => setForm((prev) => ({ ...prev, collectingEntityId }))}
      />

      <CampaignLocationFields
        value={{
          province: form.province,
          regency: form.regency,
          beneficiaryDescription: form.beneficiaryDescription,
          beneficiaryCount: form.beneficiaryCount,
        }}
        errors={errors}
        onChange={(location) => setForm((prev) => ({ ...prev, ...location }))}
      />

      <CoverImageField
        preview={preview}
        error={errors.coverImage}
        onPick={(file) => {
          setNewCover({ file, preview: URL.createObjectURL(file) });
          setCoverCleared(false);
        }}
        onError={(coverImage) => setErrors((prev) => ({ ...prev, coverImage }))}
        onClear={() => {
          setNewCover(null);
          setCoverCleared(true);
        }}
      />

      <CampaignStoryField
        value={form.story}
        error={errors.story}
        onChange={(story) => setForm((prev) => ({ ...prev, story }))}
      />

      <div className="flex gap-3 pt-4">
        <Button variant="secondary" size="full" onClick={() => save(false)} isLoading={pending === 'save'} disabled={pending !== null}>
          Simpan Perubahan
        </Button>
        <Button variant="primary" size="full" onClick={() => save(true)} isLoading={pending === 'submit'} disabled={pending !== null}>
          Simpan dan Ajukan ke Verifier
        </Button>
      </div>
    </div>
  );
}
