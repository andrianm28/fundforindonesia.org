'use client';

/* eslint-disable @next/next/no-img-element */
import React, { useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CreateCampaignStepIndicator } from '@/components/campaign/CreateCampaignStepIndicator';

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

interface FormData {
  title: string;
  targetAmount: string;
  deadline: string;
  category: string;
  coverImage: File | null;
  coverImagePreview: string;
  story: string;
}

interface FormErrors {
  title?: string;
  targetAmount?: string;
  deadline?: string;
  category?: string;
  coverImage?: string;
  story?: string;
}

export default function CampaignCreatePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [formData, setFormData] = useState<FormData>({
    title: '',
    targetAmount: '',
    deadline: '',
    category: '',
    coverImage: null,
    coverImagePreview: '',
    story: '',
  });

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

  // KYC verification gate
  if (session && !session.user.isVerified) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6 p-8 bg-white rounded-lg shadow-card">
          <div className="w-16 h-16 mx-auto bg-warning/10 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-warning"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-text">Verifikasi Identitas Diperlukan</h1>
          <p className="text-text-secondary">
            Anda harus verifikasi identitas terlebih dahulu sebelum dapat membuat campaign penggalangan dana.
          </p>
          <div className="space-y-3">
            <Button
              variant="primary"
              size="full"
              onClick={() => router.push('/akun')}
            >
              Verifikasi Sekarang
            </Button>
            <Button
              variant="ghost"
              size="full"
              onClick={() => router.push('/')}
            >
              Kembali ke Beranda
            </Button>
          </div>
        </div>
      </div>
    );
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

    if (!formData.deadline) {
      newErrors.deadline = 'Batas waktu harus dipilih';
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

  async function handleSubmit() {
    setIsSubmitting(true);
    setSubmitError('');

    try {
      // Upload image first (simulate with a data URL for now)
      let coverImageUrl = formData.coverImagePreview;

      if (formData.coverImage) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.coverImage);

        try {
          const uploadRes = await fetch('/api/upload', {
            method: 'POST',
            body: uploadFormData,
          });

          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            coverImageUrl = uploadData.url;
          }
        } catch {
          // If upload API doesn't exist, use placeholder
          coverImageUrl = '/images/placeholder-campaign.jpg';
        }
      }

      const amount = parseInt(formData.targetAmount.replace(/\D/g, ''), 10);
      const payload = {
        title: formData.title.trim(),
        description: formData.story.trim().substring(0, 200),
        story: formData.story.trim(),
        coverImage: coverImageUrl,
        targetAmount: amount,
        category: formData.category,
        deadline: formData.deadline
          ? new Date(formData.deadline).toISOString()
          : undefined,
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
      router.push(`/campaign/${campaign.slug}`);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'Terjadi kesalahan. Silakan coba lagi.'
      );
    } finally {
      setIsSubmitting(false);
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
                  Batas Waktu <span className="text-danger ml-0.5">*</span>
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
                <Button variant="secondary" size="md" onClick={handleBack}>
                  Kembali
                </Button>
                <Button
                  variant="primary"
                  size="full"
                  onClick={handleSubmit}
                  isLoading={isSubmitting}
                  disabled={isSubmitting}
                >
                  Buat Campaign
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
