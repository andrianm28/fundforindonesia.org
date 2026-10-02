'use client';

/* eslint-disable @next/next/no-img-element */
import React, { useEffect, useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CreateCampaignStepIndicator } from '@/components/campaign/CreateCampaignStepIndicator';
import { submitToVerifier } from '@/lib/verification-submission';
import { deadlineRequired, KIND_LABEL, KINDS, type CampaignKind } from '@/lib/campaign-kind';

const categories = [
  { value: 'bencana-alam', label: 'Bencana Alam' },
  { value: 'kesehatan', label: 'Bantuan Medis & Kesehatan' },
  { value: 'pendidikan', label: 'Pendidikan' },
  { value: 'anak', label: 'Balita & Anak Sakit' },
  { value: 'lingkungan', label: 'Lingkungan' },
  { value: 'kemanusiaan', label: 'Kemanusiaan' },
  { value: 'infrastruktur', label: 'Infrastruktur' },
  { value: 'lainnya', label: 'Lainnya' },
];

/** What GET /api/partner-organisations/sponsors answers (prd-compliance 10). */
interface SponsorOptions {
  own: { id: string; name: string } | null;
  sponsors: { id: string; name: string }[];
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentStep, setCurrentStep] = useState(1);
  // Which review action is running: saving the Draft, or submitting it.
  const [pendingAction, setPendingAction] = useState<'draft' | 'submit' | null>(null);
  // The Draft once created, so a retried submission never creates another.
  const [draftSlug, setDraftSlug] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  // Who may collect this Campaign's money (ADR 0010): null while loading.
  const [sponsorOptions, setSponsorOptions] = useState<SponsorOptions | null>(null);
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

    if (!formData.title.trim()) {
      newErrors.title = 'Judul campaign harus diisi';
    } else if (formData.title.length > 200) {
      newErrors.title = 'Judul maksimal 200 karakter';
    }

    const amount = parseInt(formData.targetAmount.replace(/\D/g, ''), 10);
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
    if (!formData.deadline) {
      if (!formData.kind || deadlineRequired(formData.kind)) {
        newErrors.deadline = 'Batas waktu harus dipilih';
      }
    } else {
      const deadlineDate = new Date(formData.deadline);
      if (deadlineDate <= new Date()) {
        newErrors.deadline = 'Batas waktu harus di masa depan';
      }
    }

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

    if (!formData.story.trim()) {
      newErrors.story = 'Cerita campaign harus diisi';
    } else if (formData.story.trim().length < 50) {
      newErrors.story = 'Cerita campaign minimal 50 karakter';
    }

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

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setErrors((prev) => ({ ...prev, coverImage: 'File harus berupa gambar' }));
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setErrors((prev) => ({ ...prev, coverImage: 'Ukuran file maksimal 5MB' }));
        return;
      }
      setErrors((prev) => ({ ...prev, coverImage: undefined }));
      setFormData((prev) => ({
        ...prev,
        coverImage: file,
        coverImagePreview: URL.createObjectURL(file),
      }));
    }
  }

  function formatCurrency(value: string): string {
    const numbers = value.replace(/\D/g, '');
    if (!numbers) return '';
    return parseInt(numbers, 10).toLocaleString('id-ID');
  }

  /** Creates the Draft (once), returning its slug. */
  async function createDraft(): Promise<string> {
    if (draftSlug) return draftSlug;

    // Upload the cover first. A failed upload stops the submit: a placeholder
    // or a blob/data URL would be refused by the API (coverImageSchema).
    const uploadError = 'Gagal mengunggah gambar sampul. Silakan coba lagi.';
    if (!formData.coverImage) throw new Error('Gambar sampul wajib diunggah.');
    const uploadFormData = new FormData();
    uploadFormData.append('file', formData.coverImage);

    let uploaded: { url?: string } | null = null;
    try {
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: uploadFormData,
      });
      if (uploadRes.ok) uploaded = (await uploadRes.json()) as { url?: string };
    } catch {
      uploaded = null;
    }
    if (!uploaded?.url) throw new Error(uploadError);
    const coverImageUrl = uploaded.url;

    const amount = parseInt(formData.targetAmount.replace(/\D/g, ''), 10);
    const payload = {
      title: formData.title.trim(),
      description: formData.story.trim().substring(0, 200),
      story: formData.story.trim(),
      coverImage: coverImageUrl,
      targetAmount: amount,
      category: formData.category,
      kind: formData.kind,
      deadline: formData.deadline
        ? new Date(formData.deadline).toISOString()
        : undefined,
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
    return campaign.slug;
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
      const slug = await createDraft();
      created = true;
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

              <div className="w-full">
                <label htmlFor="campaign-kind" className="block text-sm font-medium text-text mb-1.5">
                  Kind <span className="text-danger ml-0.5">*</span>
                </label>
                <select
                  id="campaign-kind"
                  aria-label="Kind"
                  value={formData.kind}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, kind: e.target.value as CampaignKind | '' }))
                  }
                  className={`w-full px-3 py-2.5 text-sm rounded-md border transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                    errors.kind
                      ? 'border-danger focus:ring-danger/20 focus:border-danger'
                      : 'border-border hover:border-text-secondary/50'
                  }`}
                >
                  <option value="">Pilih Kind</option>
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABEL[kind]}
                    </option>
                  ))}
                </select>
                {errors.kind ? (
                  <p className="mt-1 text-xs text-danger">{errors.kind}</p>
                ) : (
                  <p className="mt-1 text-xs text-text-secondary">
                    Kind menentukan aturan dana Campaign dan tidak dapat diubah setelah diajukan.
                  </p>
                )}
              </div>

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
                    targetAmount: formatCurrency(val),
                  }))
                }
                error={errors.targetAmount}
                prefix="Rp"
                required
              />

              <div className="w-full">
                <label className="block text-sm font-medium text-text mb-1.5">
                  Batas Waktu{' '}
                  {formData.kind === 'WAKAF' ? (
                    <span className="text-text-secondary font-normal">(opsional untuk Wakaf)</span>
                  ) : (
                    <span className="text-danger ml-0.5">*</span>
                  )}
                </label>
                <input
                  type="date"
                  value={formData.deadline}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, deadline: e.target.value }))
                  }
                  min={new Date().toISOString().split('T')[0]}
                  className={`w-full px-3 py-2.5 text-sm rounded-md border transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                    errors.deadline
                      ? 'border-danger focus:ring-danger/20 focus:border-danger'
                      : 'border-border hover:border-text-secondary/50'
                  }`}
                />
                {errors.deadline && (
                  <p className="mt-1 text-xs text-danger">{errors.deadline}</p>
                )}
              </div>

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
                  className={`w-full px-3 py-2.5 text-sm rounded-md border transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                    errors.category
                      ? 'border-danger focus:ring-danger/20 focus:border-danger'
                      : 'border-border hover:border-text-secondary/50'
                  }`}
                >
                  <option value="">Pilih Kategori</option>
                  {categories.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
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

              {/* Cover Image Upload */}
              <div className="w-full">
                <label className="block text-sm font-medium text-text mb-1.5">
                  Gambar Cover <span className="text-danger ml-0.5">*</span>
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                    errors.coverImage
                      ? 'border-danger bg-danger/5'
                      : 'border-border hover:border-primary hover:bg-primary/5'
                  }`}
                >
                  {formData.coverImagePreview ? (
                    <div className="relative">
                      <img
                        src={formData.coverImagePreview}
                        alt="Preview cover"
                        className="w-full h-48 object-cover rounded-md"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFormData((prev) => ({
                            ...prev,
                            coverImage: null,
                            coverImagePreview: '',
                          }));
                        }}
                        className="absolute top-2 right-2 bg-white/90 rounded-full p-1 hover:bg-white"
                      >
                        <svg className="w-4 h-4 text-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="py-8">
                      <svg
                        className="w-12 h-12 mx-auto text-text-secondary mb-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                      <p className="text-sm text-text-secondary">
                        Klik untuk unggah gambar cover
                      </p>
                      <p className="text-xs text-text-secondary mt-1">
                        Format: JPG, PNG. Maks 5MB
                      </p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
                {errors.coverImage && (
                  <p className="mt-1 text-xs text-danger">{errors.coverImage}</p>
                )}
              </div>

              {/* Story textarea */}
              <div className="w-full">
                <label className="block text-sm font-medium text-text mb-1.5">
                  Cerita Campaign <span className="text-danger ml-0.5">*</span>
                </label>
                <textarea
                  value={formData.story}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, story: e.target.value }))
                  }
                  placeholder="Ceritakan alasan Anda membuat penggalangan dana ini. Sertakan detail tentang siapa yang akan dibantu dan bagaimana dana akan digunakan."
                  rows={8}
                  className={`w-full px-3 py-2.5 text-sm rounded-md border transition-colors duration-150 resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-text-secondary/60 ${
                    errors.story
                      ? 'border-danger focus:ring-danger/20 focus:border-danger'
                      : 'border-border hover:border-text-secondary/50'
                  }`}
                />
                {errors.story && (
                  <p className="mt-1 text-xs text-danger">{errors.story}</p>
                )}
                <p className="mt-1 text-xs text-text-secondary">
                  {formData.story.length} karakter (minimal 50)
                </p>
              </div>

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
                        ? new Date(formData.deadline).toLocaleDateString('id-ID', {
                            day: '2-digit',
                            month: 'long',
                            year: 'numeric',
                          })
                        : formData.kind === 'WAKAF'
                          ? 'Tanpa batas waktu'
                          : '-'}
                    </p>
                  </div>
                  <div className="py-3">
                    <p className="text-xs text-text-secondary mb-0.5">Kategori</p>
                    <p className="text-sm font-medium text-text">
                      {categories.find((c) => c.value === formData.category)?.label || '-'}
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
                  disabled={pendingAction !== null}
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

/**
 * Who collects the Campaign's money (CONTEXT.md, Collecting Entity; ADR
 * 0010), said plainly: an organisation's own account collects in its
 * organisation's name; an individual Fundraiser picks a sponsoring Partner
 * Organisation, which a Verifier confirms when approving.
 */
function CollectingEntityField({
  options,
  value,
  error,
  onChange,
}: {
  options: SponsorOptions | null;
  value: string;
  error?: string;
  onChange: (id: string) => void;
}) {
  if (!options) {
    return <p className="text-xs text-text-secondary">Memuat Partner Organisation...</p>;
  }
  if (options.own) {
    return (
      <div data-testid="collecting-entity" className="w-full rounded-md bg-bg-secondary p-3">
        <p className="text-sm font-medium text-text mb-1">Collecting Entity</p>
        <p className="text-sm text-text">
          Dana Campaign ini dihimpun atas nama {options.own.name}, organisasi yang diwakili akun Anda.
        </p>
      </div>
    );
  }
  return (
    <div data-testid="collecting-entity" className="w-full">
      <label htmlFor="collecting-entity" className="block text-sm font-medium text-text mb-1.5">
        Collecting Entity <span className="text-danger ml-0.5">*</span>
      </label>
      <p className="mb-2 text-xs text-text-secondary">
        Fundraiser perorangan menggalang dana di bawah naungan Partner Organisation yang memegang Fundraising
        Permit: dana Campaign dihimpun atas nama Partner Organisation itu, bukan atas nama Anda atau platform.
        Verifier mengonfirmasi Partner Organisation yang menaungi saat meloloskan pengajuan.
      </p>
      {options.sponsors.length === 0 ? (
        <p className="text-sm text-danger">
          Belum ada Partner Organisation yang menaungi Campaign perorangan. Anda tetap dapat menyimpan Draft,
          tetapi belum dapat mengajukannya ke Verifier.
        </p>
      ) : (
        <select
          id="collecting-entity"
          aria-label="Collecting Entity"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full px-3 py-2.5 text-sm rounded-md border transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
            error ? 'border-danger focus:ring-danger/20 focus:border-danger' : 'border-border hover:border-text-secondary/50'
          }`}
        >
          <option value="">Pilih Partner Organisation</option>
          {options.sponsors.map((sponsor) => (
            <option key={sponsor.id} value={sponsor.id}>
              {sponsor.name}
            </option>
          ))}
        </select>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
