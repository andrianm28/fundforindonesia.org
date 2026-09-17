'use client';

import { useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Modal } from '@/components/ui/Modal';

export interface VerificationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type VerificationType = 'ktp' | 'organization';
type Step = 'type-selection' | 'form' | 'success';

interface FormErrors {
  fullName?: string;
  nik?: string;
  orgName?: string;
  regNumber?: string;
}

export function VerificationDialog({ isOpen, onClose, onSuccess }: VerificationDialogProps) {
  const { update } = useSession();
  const [step, setStep] = useState<Step>('type-selection');
  const [verificationType, setVerificationType] = useState<VerificationType | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);

  // KTP form fields
  const [fullName, setFullName] = useState('');
  const [nik, setNik] = useState('');

  // Organization form fields
  const [orgName, setOrgName] = useState('');
  const [regNumber, setRegNumber] = useState('');

  const resetState = useCallback(() => {
    setStep('type-selection');
    setVerificationType(null);
    setIsSubmitting(false);
    setErrors({});
    setApiError(null);
    setFullName('');
    setNik('');
    setOrgName('');
    setRegNumber('');
  }, []);

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleTypeSelect = (type: VerificationType) => {
    setVerificationType(type);
    setStep('form');
    setErrors({});
    setApiError(null);
  };

  const handleBack = () => {
    setStep('type-selection');
    setErrors({});
    setApiError(null);
  };

  const validateKTP = (): boolean => {
    const newErrors: FormErrors = {};

    if (fullName.length < 2) {
      newErrors.fullName = 'Nama minimal 2 karakter';
    } else if (fullName.length > 100) {
      newErrors.fullName = 'Nama maksimal 100 karakter';
    }

    if (!/^\d{16}$/.test(nik)) {
      newErrors.nik = 'NIK harus 16 digit';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateOrganization = (): boolean => {
    const newErrors: FormErrors = {};

    if (orgName.length < 2) {
      newErrors.orgName = 'Nama organisasi minimal 2 karakter';
    } else if (orgName.length > 100) {
      newErrors.orgName = 'Nama maksimal 100 karakter';
    }

    if (regNumber.length < 5) {
      newErrors.regNumber = 'Nomor registrasi minimal 5 karakter';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;

    // Validate based on type
    if (verificationType === 'ktp') {
      if (!validateKTP()) return;
    } else if (verificationType === 'organization') {
      if (!validateOrganization()) return;
    }

    setIsSubmitting(true);
    setApiError(null);

    try {
      const payload = verificationType === 'ktp'
        ? { type: 'ktp', fullName, nik }
        : { type: 'organization', orgName, regNumber };

      const res = await fetch('/api/user/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        if (data.fieldErrors) {
          const newErrors: FormErrors = {};
          if (data.fieldErrors.fullName) newErrors.fullName = data.fieldErrors.fullName[0];
          if (data.fieldErrors.nik) newErrors.nik = data.fieldErrors.nik[0];
          if (data.fieldErrors.orgName) newErrors.orgName = data.fieldErrors.orgName[0];
          if (data.fieldErrors.regNumber) newErrors.regNumber = data.fieldErrors.regNumber[0];
          setErrors(newErrors);
        } else {
          setApiError(data.error || 'Terjadi kesalahan');
        }
        return;
      }

      // Success — refresh session to reflect new role
      await update();
      setStep('success');
      onSuccess?.();
    } catch {
      setApiError('Terjadi kesalahan jaringan. Silakan coba lagi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getTitle = () => {
    switch (step) {
      case 'type-selection':
        return 'Verifikasi Identitas';
      case 'form':
        return verificationType === 'ktp' ? 'Verifikasi KTP' : 'Verifikasi Organisasi';
      case 'success':
        return 'Verifikasi Berhasil';
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={getTitle()} size="sm">
      {step === 'type-selection' && (
        <TypeSelection onSelect={handleTypeSelect} />
      )}

      {step === 'form' && verificationType === 'ktp' && (
        <KTPForm
          fullName={fullName}
          nik={nik}
          onFullNameChange={setFullName}
          onNikChange={setNik}
          errors={errors}
          apiError={apiError}
          isSubmitting={isSubmitting}
          onSubmit={handleSubmit}
          onBack={handleBack}
        />
      )}

      {step === 'form' && verificationType === 'organization' && (
        <OrganizationForm
          orgName={orgName}
          regNumber={regNumber}
          onOrgNameChange={setOrgName}
          onRegNumberChange={setRegNumber}
          errors={errors}
          apiError={apiError}
          isSubmitting={isSubmitting}
          onSubmit={handleSubmit}
          onBack={handleBack}
        />
      )}

      {step === 'success' && (
        <SuccessConfirmation onClose={handleClose} />
      )}
    </Modal>
  );
}

// Step 1: Type Selection
function TypeSelection({ onSelect }: { onSelect: (type: VerificationType) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[#757575] mb-4">
        Pilih metode verifikasi untuk mulai membuat kampanye galang dana.
      </p>

      <button
        onClick={() => onSelect('ktp')}
        className="w-full flex items-center gap-4 p-4 border border-[#E0E0E0] rounded-xl hover:border-[#0073E6] hover:bg-blue-50/50 transition-colors text-left"
      >
        <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
          <svg className="w-6 h-6 text-[#0073E6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
          </svg>
        </div>
        <div>
          <p className="text-[#212121] font-medium text-sm">KTP (Pribadi)</p>
          <p className="text-[#757575] text-xs mt-0.5">Verifikasi menggunakan Kartu Tanda Penduduk</p>
        </div>
      </button>

      <button
        onClick={() => onSelect('organization')}
        className="w-full flex items-center gap-4 p-4 border border-[#E0E0E0] rounded-xl hover:border-[#0073E6] hover:bg-blue-50/50 transition-colors text-left"
      >
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
          <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        </div>
        <div>
          <p className="text-[#212121] font-medium text-sm">Organisasi</p>
          <p className="text-[#757575] text-xs mt-0.5">Verifikasi sebagai organisasi/lembaga</p>
        </div>
      </button>
    </div>
  );
}

// Step 2a: KTP Form
function KTPForm({
  fullName,
  nik,
  onFullNameChange,
  onNikChange,
  errors,
  apiError,
  isSubmitting,
  onSubmit,
  onBack,
}: {
  fullName: string;
  nik: string;
  onFullNameChange: (val: string) => void;
  onNikChange: (val: string) => void;
  errors: FormErrors;
  apiError: string | null;
  isSubmitting: boolean;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const handleNikChange = (value: string) => {
    // Only allow digits
    const digitsOnly = value.replace(/\D/g, '');
    // Limit to 16 digits
    onNikChange(digitsOnly.slice(0, 16));
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-[#757575] hover:text-[#212121] transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Kembali
      </button>

      {apiError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {apiError}
        </div>
      )}

      <div>
        <label htmlFor="fullName" className="block text-sm font-medium text-[#212121] mb-1.5">
          Nama Lengkap
        </label>
        <input
          id="fullName"
          type="text"
          value={fullName}
          onChange={(e) => onFullNameChange(e.target.value)}
          placeholder="Masukkan nama sesuai KTP"
          className={`w-full px-3 py-2.5 border rounded-lg text-sm text-[#212121] placeholder-[#9E9E9E] focus:outline-none focus:ring-2 focus:ring-[#0073E6]/20 focus:border-[#0073E6] transition-colors ${
            errors.fullName ? 'border-red-400' : 'border-[#E0E0E0]'
          }`}
        />
        {errors.fullName && (
          <p className="mt-1 text-xs text-red-500">{errors.fullName}</p>
        )}
      </div>

      <div>
        <label htmlFor="nik" className="block text-sm font-medium text-[#212121] mb-1.5">
          NIK (Nomor Induk Kependudukan)
        </label>
        <input
          id="nik"
          type="text"
          inputMode="numeric"
          value={nik}
          onChange={(e) => handleNikChange(e.target.value)}
          placeholder="Masukkan 16 digit NIK"
          className={`w-full px-3 py-2.5 border rounded-lg text-sm text-[#212121] placeholder-[#9E9E9E] focus:outline-none focus:ring-2 focus:ring-[#0073E6]/20 focus:border-[#0073E6] transition-colors ${
            errors.nik ? 'border-red-400' : 'border-[#E0E0E0]'
          }`}
        />
        {errors.nik && (
          <p className="mt-1 text-xs text-red-500">{errors.nik}</p>
        )}
        <p className="mt-1 text-xs text-[#9E9E9E]">{nik.length}/16 digit</p>
      </div>

      <button
        onClick={onSubmit}
        disabled={isSubmitting}
        className="w-full bg-[#0073E6] text-white py-2.5 rounded-lg font-medium text-sm hover:bg-[#005BB5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting ? 'Memproses...' : 'Kirim Verifikasi'}
      </button>
    </div>
  );
}

// Step 2b: Organization Form
function OrganizationForm({
  orgName,
  regNumber,
  onOrgNameChange,
  onRegNumberChange,
  errors,
  apiError,
  isSubmitting,
  onSubmit,
  onBack,
}: {
  orgName: string;
  regNumber: string;
  onOrgNameChange: (val: string) => void;
  onRegNumberChange: (val: string) => void;
  errors: FormErrors;
  apiError: string | null;
  isSubmitting: boolean;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-[#757575] hover:text-[#212121] transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Kembali
      </button>

      {apiError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {apiError}
        </div>
      )}

      <div>
        <label htmlFor="orgName" className="block text-sm font-medium text-[#212121] mb-1.5">
          Nama Organisasi
        </label>
        <input
          id="orgName"
          type="text"
          value={orgName}
          onChange={(e) => onOrgNameChange(e.target.value)}
          placeholder="Masukkan nama organisasi"
          className={`w-full px-3 py-2.5 border rounded-lg text-sm text-[#212121] placeholder-[#9E9E9E] focus:outline-none focus:ring-2 focus:ring-[#0073E6]/20 focus:border-[#0073E6] transition-colors ${
            errors.orgName ? 'border-red-400' : 'border-[#E0E0E0]'
          }`}
        />
        {errors.orgName && (
          <p className="mt-1 text-xs text-red-500">{errors.orgName}</p>
        )}
      </div>

      <div>
        <label htmlFor="regNumber" className="block text-sm font-medium text-[#212121] mb-1.5">
          Nomor Registrasi
        </label>
        <input
          id="regNumber"
          type="text"
          value={regNumber}
          onChange={(e) => onRegNumberChange(e.target.value)}
          placeholder="Masukkan nomor registrasi organisasi"
          className={`w-full px-3 py-2.5 border rounded-lg text-sm text-[#212121] placeholder-[#9E9E9E] focus:outline-none focus:ring-2 focus:ring-[#0073E6]/20 focus:border-[#0073E6] transition-colors ${
            errors.regNumber ? 'border-red-400' : 'border-[#E0E0E0]'
          }`}
        />
        {errors.regNumber && (
          <p className="mt-1 text-xs text-red-500">{errors.regNumber}</p>
        )}
      </div>

      <button
        onClick={onSubmit}
        disabled={isSubmitting}
        className="w-full bg-[#0073E6] text-white py-2.5 rounded-lg font-medium text-sm hover:bg-[#005BB5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting ? 'Memproses...' : 'Kirim Verifikasi'}
      </button>
    </div>
  );
}

// Step 3: Success Confirmation
function SuccessConfirmation({ onClose }: { onClose: () => void }) {
  return (
    <div className="text-center py-4">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-[#212121] mb-2">
        Verifikasi Berhasil!
      </h3>
      <p className="text-sm text-[#757575] mb-6">
        Identitas Anda telah terverifikasi. Sekarang Anda dapat membuat kampanye galang dana.
      </p>
      <button
        onClick={onClose}
        className="w-full bg-[#0073E6] text-white py-2.5 rounded-lg font-medium text-sm hover:bg-[#005BB5] transition-colors"
      >
        Tutup
      </button>
    </div>
  );
}

export default VerificationDialog;
