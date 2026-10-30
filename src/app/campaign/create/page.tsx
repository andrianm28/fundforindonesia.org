'use client';

/* eslint-disable @next/next/no-img-element */
import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CreateCampaignStepIndicator } from '@/components/campaign/CreateCampaignStepIndicator';
import { submitToVerifier } from '@/lib/verification-submission';
import { formatWibLongDate } from '@/lib/utils/date';
import { KIND_LABEL, type CampaignKind } from '@/lib/campaign-kind';
import {
  contentPayload,
  deadlineError,
  formatRupiahInput,
  parseRupiahInput,
  storyError,
  titleError,
  uploadCoverImage,
} from '@/lib/campaign-form';
import { CollectingEntityField, type SponsorOptions } from '@/components/campaign/CollectingEntityField';
import { CampaignKindField } from '@/components/campaign/CampaignKindField';
import { CampaignDeadlineField } from '@/components/campaign/CampaignDeadlineField';
import { CoverImageField } from '@/components/campaign/CoverImageField';
import { CampaignStoryField } from '@/components/campaign/CampaignStoryField';
import { DOCUMENT_ACCEPT } from '@/components/documents/DocumentUpload';

/** One Category from GET /api/categories, the Category table. */
interface CategoryOption {
  slug: string;
  name: string;
}

/** A §7.1 checklist item this Kind must carry a document for (ticket 64). */
interface DocumentItem {
  id: string;
  label: string;
  required: boolean;
}

interface FormData {
  kind: CampaignKind | '';
  collectingEntityId: string;
  title: string;
  targetAmount: string;
  deadline: string;
  category: string;
  coverImage: File | null;
  coverImagePreview: string;
  story: string;
}

interface FormErrors {
  kind?: string;
  collectingEntityId?: string;
  title?: string;
  targetAmount?: string;
  deadline?: string;
  category?: string;
  coverImage?: string;
  story?: string;
}

export default function CampaignCreatePage() {
  const { status } = useSession();
  const router = useRouter();

  const [currentStep, setCurrentStep] = useState(1);
  // Which review action is running: saving the Draft, or submitting it.
  const [pendingAction, setPendingAction] = useState<'draft' | 'submit' | null>(null);
  // The Draft once created, so a retried submission never creates another.
  const [draftSlug, setDraftSlug] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  // The documents the chosen Kind needs, and the file picked for each. An
  // item is dropped from `documentFiles` once uploaded, so a retry never
  // uploads it twice.
  const [documentItems, setDocumentItems] = useState<DocumentItem[]>([]);
  const [documentFiles, setDocumentFiles] = useState<Record<string, File>>({});
  const [uploadedItems, setUploadedItems] = useState<ReadonlySet<string>>(new Set());
  const [submitError, setSubmitError] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  // Who may collect this Campaign's money (ADR 0010): null while loading.
  const [sponsorOptions, setSponsorOptions] = useState<SponsorOptions | null>(null);
  // The Categories an Admin keeps; empty while loading or if the read fails.
  // null while loading; [] when none exist or the request failed.
  const [categories, setCategories] = useState<CategoryOption[] | null>(null);
  const [formData, setFormData] = useState<FormData>({
    kind: '',
    collectingEntityId: '',
    title: '',
    targetAmount: '',
    deadline: '',
    category: '',
    coverImage: null,
    coverImagePreview: '',
    story: '',
  });

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    fetch('/api/partner-organisations/sponsors')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((options: SponsorOptions) => {
        if (!cancelled) setSponsorOptions(options);
      })
      // Nothing to offer: the Draft can still be saved, and submitting it
      // is refused until it names a Collecting Entity.
      .catch(() => {
        if (!cancelled) setSponsorOptions({ own: null, sponsors: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/categories')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { categories: CategoryOption[] }) => {
        if (!cancelled) setCategories(data.categories);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The papers PRD §7.1 asks of this Kind, once a Kind is chosen. A failed
  // read offers none: the Draft can still be saved and the documents added
  // from Galang Dana Saya.
  useEffect(() => {
    if (status !== 'authenticated' || !formData.kind) return;
    let cancelled = false;
    fetch(`/api/verification-checklist/documents?kind=${formData.kind}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { items?: DocumentItem[] }) => {
        if (!cancelled) setDocumentItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setDocumentItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [status, formData.kind]);

  const missingDocuments = documentItems.filter(
    (item) => item.required && !documentFiles[item.id] && !uploadedItems.has(item.id)
  );

  // An individual Fundraiser must pick a sponsor when there is one to pick.
  const mustPickSponsor = !!sponsorOptions && !sponsorOptions.own && sponsorOptions.sponsors.length > 0;
  const collectingEntityName = sponsorOptions?.own
    ? sponsorOptions.own.name
    : sponsorOptions?.sponsors.find((o) => o.id === formData.collectingEntityId)?.name;

  // Loading state
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Not authenticated - redirect to login
  if (status === 'unauthenticated') {
    router.push('/login?callbackUrl=/campaign/create');
    return null;
  }

  // Validation functions
  function validateStep1(): boolean {
    const newErrors: FormErrors = {};

    const titleProblem = titleError(formData.title);
    if (titleProblem) newErrors.title = titleProblem;

    const amount = parseRupiahInput(formData.targetAmount);
    if (!formData.targetAmount.trim() || isNaN(amount) || amount <= 0) {
      newErrors.targetAmount = 'Target donasi harus lebih dari 0';
    }

    if (!formData.kind) {
      newErrors.kind = 'Kind harus dipilih';
    }

    if (mustPickSponsor && !formData.collectingEntityId) {
      newErrors.collectingEntityId = 'Pilih Partner Organisation yang menaungi Campaign ini';
    }

    // Every Kind but wakaf needs a deadline (CONTEXT.md, Campaign).
    const deadlineProblem = deadlineError(formData.kind, formData.deadline);
    if (deadlineProblem) newErrors.deadline = deadlineProblem;

    if (!formData.category) {
      newErrors.category = 'Kategori harus dipilih';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function validateStep2(): boolean {
    const newErrors: FormErrors = {};

    if (!formData.coverImage && !formData.coverImagePreview) {
      newErrors.coverImage = 'Gambar cover harus diunggah';
    }

    const storyProblem = storyError(formData.story);
    if (storyProblem) newErrors.story = storyProblem;

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleNext() {
    if (currentStep === 1 && validateStep1()) {
      setCurrentStep(2);
    } else if (currentStep === 2 && validateStep2()) {
      setCurrentStep(3);
    }
  }

  function handleBack() {
    setErrors({});
    setCurrentStep((prev) => Math.max(1, prev - 1));
  }

  /** Creates the Draft (once), returning its slug. */
  async function createDraft(): Promise<{ slug: string; id: string | null }> {
    if (draftSlug) return { slug: draftSlug, id: draftId };

    // Upload the cover first. A failed upload stops the submit: a placeholder
    // or a blob/data URL would be refused by the API (coverImageSchema).
    if (!formData.coverImage) throw new Error('Gambar sampul wajib diunggah.');
    const coverImageUrl = await uploadCoverImage(formData.coverImage);

    const amount = parseRupiahInput(formData.targetAmount);
    const payload = {
      ...contentPayload(formData),
      coverImage: coverImageUrl,
      targetAmount: amount,
      category: formData.category,
      kind: formData.kind,
      // An organisation's own account gets its organisation on the server.
      collectingEntityId:
        !sponsorOptions?.own && formData.collectingEntityId ? formData.collectingEntityId : undefined,
    };

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Gagal membuat campaign');
    }

    const campaign = await res.json();
    setDraftSlug(campaign.slug);
    setDraftId(campaign.id ?? null);
    return { slug: campaign.slug, id: campaign.id ?? null };
  }

  /**
   * Uploads each picked document to the private store (ticket 64), never to
   * /api/upload, whose files are public. Stops at the first refusal, naming
   * the document; the ones already stored are not sent again on a retry.
   */
  async function uploadDocuments(campaignId: string | null) {
    for (const item of documentItems) {
      const file = documentFiles[item.id];
      if (!file || uploadedItems.has(item.id)) continue;
      if (!campaignId) throw new Error('Dokumen belum terunggah. Tambahkan dari Galang Dana Saya.');
      const body = new FormData();
      body.append('campaignId', campaignId);
      body.append('checklistItemId', item.id);
      body.append('file', file);
      const res = await fetch('/api/documents', { method: 'POST', body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(`${item.label}: ${typeof data.error === 'string' ? data.error : 'gagal diunggah'}`);
      }
      setUploadedItems((current) => new Set(current).add(item.id));
    }
  }

  /**
   * "Simpan Draft" creates the Campaign as a Draft; "Ajukan ke Verifier" also
   * submits it, opening its Verification Request. Either way the Fundraiser
   * lands on their Campaigns, where a Draft can be submitted later.
   */
  async function handleSave(action: 'draft' | 'submit') {
    setPendingAction(action);
    setSubmitError('');

    let created = false;
    try {
      const { slug, id } = await createDraft();
      created = true;
      await uploadDocuments(id);
      if (action === 'submit') {
        const refused = await submitToVerifier(slug);
        if (refused) throw new Error(refused);
      }
      router.push('/akun/kampanye-saya');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Terjadi kesalahan. Silakan coba lagi.';
      setSubmitError(
        created ? `Campaign tersimpan sebagai Draft, tetapi belum diajukan: ${message}` : message
      );
    } finally {
      setPendingAction(null);
    }
  }

  // Step indicator
  const steps = [
    { number: 1, label: 'Info Dasar' },
    { number: 2, label: 'Konten' },
    { number: 3, label: 'Review' },
  ];

  return (
    <div className="min-h-screen bg-bg-secondary py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <h1 className="text-2xl font-bold text-text mb-6 text-center">
          Buat Campaign Penggalangan Dana
        </h1>

        {/* Step Indicator */}
        <CreateCampaignStepIndicator steps={steps} currentStep={currentStep} />

        {/* Form Card */}
        <div className="bg-white rounded-lg shadow-card p-6">
          {/* Step 1: Basic Info */}
          {currentStep === 1 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-text mb-4">Informasi Dasar</h2>

              <CampaignKindField
                value={formData.kind}
                error={errors.kind}
                onChange={(kind) => setFormData((prev) => ({ ...prev, kind }))}
              />

              <Input
                label="Judul Campaign"
                placeholder="Contoh: Bantu Korban Banjir Jakarta"
                value={formData.title}
                onChange={(val) => setFormData((prev) => ({ ...prev, title: val }))}
                error={errors.title}
                required
                helperText={`${formData.title.length}/200 karakter`}
              />

              <Input
                label="Target Donasi"
                placeholder="1.000.000"
                value={formData.targetAmount}
                onChange={(val) =>
                  setFormData((prev) => ({
                    ...prev,
                    targetAmount: formatRupiahInput(val),
                  }))
                }
                error={errors.targetAmount}
                prefix="Rp"
                required
              />

              <CampaignDeadlineField
                kind={formData.kind}
                value={formData.deadline}
                error={errors.deadline}
                onChange={(deadline) => setFormData((prev) => ({ ...prev, deadline }))}
              />

              <div className="w-full">
                <label className="block text-sm font-medium text-text mb-1.5">
                  Kategori <span className="text-danger ml-0.5">*</span>
                </label>
                <select
                  aria-label="Kategori"
                  value={formData.category}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, category: e.target.value }))
                  }
                  className={`w-full px-3 py-2.5 text-sm rounded-md border transition-colors duration-150 focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                    errors.category
                      ? 'border-danger focus:ring-danger/20 focus:border-danger'
                      : 'border-border hover:border-text-secondary/50'
                  }`}
                >
                  <option value="">Pilih Kategori</option>
                  {(categories ?? []).map((cat) => (
                    <option key={cat.slug} value={cat.slug}>
                      {cat.name}
                    </option>
                  ))}
                </select>
                {categories?.length === 0 && (
                  <p className="mt-1 text-xs text-danger">
                    Kategori belum tersedia. Muat ulang halaman atau hubungi Admin.
                  </p>
                )}
                {errors.category && (
                  <p className="mt-1 text-xs text-danger">{errors.category}</p>
                )}
              </div>

              <CollectingEntityField
                options={sponsorOptions}
                value={formData.collectingEntityId}
                error={errors.collectingEntityId}
                onChange={(collectingEntityId) => setFormData((prev) => ({ ...prev, collectingEntityId }))}
              />

              <div className="pt-4">
                <Button variant="primary" size="full" onClick={handleNext}>
                  Lanjutkan
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Content */}
          {currentStep === 2 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-text mb-4">Konten Campaign</h2>

              <CoverImageField
                preview={formData.coverImagePreview}
                error={errors.coverImage}
                onPick={(file) =>
                  setFormData((prev) => ({ ...prev, coverImage: file, coverImagePreview: URL.createObjectURL(file) }))
                }
                onError={(coverImage) => setErrors((prev) => ({ ...prev, coverImage }))}
                onClear={() => setFormData((prev) => ({ ...prev, coverImage: null, coverImagePreview: '' }))}
              />

              <CampaignStoryField
                value={formData.story}
                error={errors.story}
                onChange={(story) => setFormData((prev) => ({ ...prev, story }))}
              />

              <div className="flex gap-3 pt-4">
                <Button variant="secondary" size="md" onClick={handleBack}>
                  Kembali
                </Button>
                <Button variant="primary" size="full" onClick={handleNext}>
                  Lanjutkan
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Review & Submit */}
          {currentStep === 3 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-text mb-4">Review Campaign</h2>

              {submitError && (
                <div className="p-3 bg-danger/10 border border-danger/20 rounded-md">
                  <p className="text-sm text-danger">{submitError}</p>
                </div>
              )}

              {/* Summary */}
              <div className="space-y-4">
                {/* Cover Image Preview */}
                {formData.coverImagePreview && (
                  <div className="rounded-lg overflow-hidden">
                    <img
                      src={formData.coverImagePreview}
                      alt="Cover campaign"
                      className="w-full h-48 object-cover"
                    />
                  </div>
                )}

                <div className="divide-y divide-border">
                  <div className="py-3">
                    <p className="text-xs text-text-secondary mb-0.5">Kind</p>
                    <p className="text-sm font-medium text-text">
                      {formData.kind ? KIND_LABEL[formData.kind] : '-'}
                    </p>
                  </div>
                  <div className="py-3">
                    <p className="text-xs text-text-secondary mb-0.5">Collecting Entity</p>
                    <p className="text-sm font-medium text-text">{collectingEntityName ?? '-'}</p>
                  </div>
                  <div className="py-3">
                    <p className="text-xs text-text-secondary mb-0.5">Judul</p>
                    <p className="text-sm font-medium text-text">{formData.title}</p>
                  </div>
                  <div className="py-3">
                    <p className="text-xs text-text-secondary mb-0.5">Target Donasi</p>
                    <p className="text-sm font-medium text-text">
                      Rp{formData.targetAmount}
                    </p>
                  </div>
                  <div className="py-3">
                    <p className="text-xs text-text-secondary mb-0.5">Batas Waktu</p>
                    <p className="text-sm font-medium text-text">
                      {formData.deadline
                        ? formatWibLongDate(formData.deadline)
                        : formData.kind === 'WAKAF'
                          ? 'Tanpa batas waktu'
                          : '-'}
                    </p>
                  </div>
                  <div className="py-3">
                    <p className="text-xs text-text-secondary mb-0.5">Kategori</p>
                    <p className="text-sm font-medium text-text">
                      {(categories ?? []).find((c) => c.slug === formData.category)?.name || '-'}
                    </p>
                  </div>
                  <div className="py-3">
                    <p className="text-xs text-text-secondary mb-0.5">Cerita</p>
                    <p className="text-sm text-text whitespace-pre-line line-clamp-4">
                      {formData.story}
                    </p>
                  </div>
                </div>
              </div>

              {/* The private papers a Verifier checks (ticket 64, PRD §7.1). */}
              {documentItems.length > 0 && (
                <div className="rounded-lg border border-border p-4 space-y-3" data-testid="campaign-documents">
                  <div>
                    <h3 className="text-sm font-semibold text-text">Dokumen</h3>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Dokumen privat: hanya Anda, Verifier yang memeriksa pengajuan Anda, dan Admin yang dapat
                      membukanya. PDF, JPEG, PNG, atau WebP, maksimal 10MB. Dokumen juga dapat ditambahkan nanti
                      dari Galang Dana Saya.
                    </p>
                  </div>
                  {documentItems.map((item) => (
                    <div key={item.id}>
                      <label className="block text-xs font-medium text-text mb-1">
                        {item.label}
                        {item.required && <span className="text-danger ml-0.5">*</span>}
                        {uploadedItems.has(item.id) && (
                          <span className="ml-2 text-[#2E7D32]">Terunggah</span>
                        )}
                        <input
                          type="file"
                          accept={DOCUMENT_ACCEPT}
                          aria-label={`Berkas ${item.label}`}
                          disabled={pendingAction !== null || uploadedItems.has(item.id)}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            setDocumentFiles((current) => {
                              const next = { ...current };
                              if (file) next[item.id] = file;
                              else delete next[item.id];
                              return next;
                            });
                          }}
                          className="mt-1 block text-xs"
                        />
                      </label>
                    </div>
                  ))}
                  {missingDocuments.length > 0 && (
                    <p className="text-xs text-danger">
                      Untuk mengajukan ke Verifier, lengkapi dulu: {missingDocuments.map((item) => item.label).join(', ')}.
                      Anda tetap dapat menyimpan Draft.
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-4">
                {/* Once the Draft exists, edits here would not reach it. */}
                <Button
                  variant="secondary"
                  size="md"
                  onClick={handleBack}
                  disabled={pendingAction !== null || draftSlug !== null}
                >
                  Kembali
                </Button>
                <Button
                  variant="secondary"
                  size="full"
                  onClick={() => handleSave('draft')}
                  isLoading={pendingAction === 'draft'}
                  disabled={pendingAction !== null || draftSlug !== null}
                >
                  Simpan Draft
                </Button>
                <Button
                  variant="primary"
                  size="full"
                  onClick={() => handleSave('submit')}
                  isLoading={pendingAction === 'submit'}
                  disabled={pendingAction !== null || missingDocuments.length > 0}
                >
                  Ajukan ke Verifier
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
