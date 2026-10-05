'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { AnonymiseDonationsSection } from '@/components/account/AnonymiseDonationsSection';

export default function SettingsPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return <SettingsSkeleton />;
  }

  if (status === 'unauthenticated') {
    return null;
  }

  const user = session?.user;

  return (
    <div className="min-h-screen bg-bg-secondary pb-20">
      {/* Header */}
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-white"
            aria-label="Kembali"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-white text-lg font-semibold">Pengaturan</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Email Display (read-only) */}
        <EmailDisplay email={user?.email || ''} />

        {/* Profile Section */}
        <ProfileSection
          currentName={user?.name || ''}
          currentAvatar={user?.image || null}
          onProfileUpdated={() => update()}
        />

        {/* Password Section */}
        <PasswordSection />

        {/* Donor anonymisation (PRD FFI-16, ticket 36) */}
        <AnonymiseDonationsSection />
      </div>
    </div>
  );
}

// ─── Email Display ───────────────────────────────────────────────────────────

function EmailDisplay({ email }: { email: string }) {
  return (
    <div className="bg-white rounded-xl shadow-xs p-4">
      <h2 className="text-text font-semibold text-sm mb-3">Email</h2>
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span className="text-text-secondary text-sm">{email}</span>
      </div>
      <p className="text-[#9E9E9E] text-xs mt-2">Email tidak dapat diubah</p>
    </div>
  );
}

// ─── Profile Section ─────────────────────────────────────────────────────────

function ProfileSection({
  currentName,
  currentAvatar,
  onProfileUpdated,
}: {
  currentName: string;
  currentAvatar: string | null;
  onProfileUpdated: () => void;
}) {
  return (
    <div className="bg-white rounded-xl shadow-xs p-4 space-y-5">
      <h2 className="text-text font-semibold text-sm">Profil</h2>
      <AvatarUpload currentAvatar={currentAvatar} onUploaded={onProfileUpdated} />
      <NameForm currentName={currentName} onUpdated={onProfileUpdated} />
    </div>
  );
}

// ─── Avatar Upload ───────────────────────────────────────────────────────────

function AvatarUpload({
  currentAvatar,
  onUploaded,
}: {
  currentAvatar: string | null;
  onUploaded: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(currentAvatar);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setSuccess(false);

    // Client-side validation
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setError('Tipe file tidak didukung. Gunakan PNG, JPG, atau WebP.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('Ukuran file terlalu besar. Maksimal 2MB.');
      return;
    }

    // Show preview
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);

    // Upload
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/user/avatar', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Gagal mengunggah avatar');
        setPreview(currentAvatar);
        return;
      }

      setPreview(data.avatar);
      setSuccess(true);
      onUploaded();
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError('Gagal mengunggah avatar. Coba lagi.');
      setPreview(currentAvatar);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-16 h-16 rounded-full overflow-hidden bg-border shrink-0">
        {preview ? (
          <Image
            src={preview}
            alt="Avatar"
            width={64}
            height={64}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#0073E6] text-white text-xl font-semibold">
            U
          </div>
        )}
        {loading && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      <div className="flex-1">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          className="text-[#0073E6] text-sm font-medium hover:underline disabled:opacity-50"
        >
          {loading ? 'Mengunggah...' : 'Ubah Foto'}
        </button>
        <p className="text-[#9E9E9E] text-xs mt-0.5">PNG, JPG, atau WebP. Maks 2MB.</p>
        {error && <p className="text-danger text-xs mt-1">{error}</p>}
        {success && <p className="text-success text-xs mt-1">Avatar berhasil diperbarui</p>}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}

// ─── Name Form ───────────────────────────────────────────────────────────────

function NameForm({
  currentName,
  onUpdated,
}: {
  currentName: string;
  onUpdated: () => void;
}) {
  const [name, setName] = useState(currentName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Follow the saved name when it changes (adjusting state during render, not in an effect).
  const [seenName, setSeenName] = useState(currentName);
  if (currentName !== seenName) {
    setSeenName(currentName);
    setName(currentName);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    // Client-side validation
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Nama minimal 2 karakter');
      return;
    }
    if (trimmed.length > 50) {
      setError('Nama maksimal 50 karakter');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.fieldErrors?.name) {
          setError(data.fieldErrors.name[0]);
        } else {
          setError(data.error || 'Gagal memperbarui nama');
        }
        return;
      }

      setName(data.user.name);
      setSuccess(true);
      onUpdated();
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError('Gagal memperbarui nama. Coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="name" className="block text-text-secondary text-xs mb-1">
          Nama Lengkap
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-hidden focus:border-[#0073E6] focus:ring-1 focus:ring-[#0073E6]"
          placeholder="Masukkan nama lengkap"
          maxLength={50}
        />
        {error && <p className="text-danger text-xs mt-1">{error}</p>}
        {success && <p className="text-success text-xs mt-1">Nama berhasil diperbarui</p>}
      </div>
      <button
        type="submit"
        disabled={loading || name.trim() === currentName}
        className="bg-[#0073E6] text-white text-sm px-4 py-2 rounded-lg font-medium hover:bg-[#005BB5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Menyimpan...' : 'Simpan Nama'}
      </button>
    </form>
  );
}

// ─── Password Section ────────────────────────────────────────────────────────

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!currentPassword) {
      newErrors.currentPassword = 'Password saat ini harus diisi';
    }
    if (newPassword.length < 8) {
      newErrors.newPassword = 'Password minimal 8 karakter';
    }
    if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = 'Konfirmasi password tidak cocok';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess(false);

    if (!validate()) return;

    setLoading(true);
    setErrors({});

    try {
      const res = await fetch('/api/user/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.fieldErrors) {
          const mapped: Record<string, string> = {};
          for (const [key, value] of Object.entries(data.fieldErrors)) {
            mapped[key] = (value as string[])[0];
          }
          setErrors(mapped);
        } else if (data.error === 'Password saat ini salah') {
          setErrors({ currentPassword: data.error });
        } else if (data.error === 'Akun Google tidak dapat mengubah password') {
          setErrors({ currentPassword: data.error });
        } else {
          setErrors({ general: data.error || 'Gagal mengubah password' });
        }
        return;
      }

      // Success - clear fields
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(true);
      // A new password ends every session issued under the old one, this one
      // included (rilis-1 93, src/lib/auth.ts), so say so and send the person
      // to sign in rather than let their next click fail silently.
      setTimeout(() => signOut({ callbackUrl: '/login' }), 1500);
    } catch {
      setErrors({ general: 'Gagal mengubah password. Coba lagi.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-xs p-4">
      <h2 className="text-text font-semibold text-sm mb-4">Ubah Password</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        {errors.general && (
          <p className="text-danger text-xs bg-red-50 p-2 rounded">{errors.general}</p>
        )}
        {success && (
          <p className="text-success text-xs bg-green-50 p-2 rounded">
            Password berhasil diubah. Silakan masuk lagi dengan password baru.
          </p>
        )}

        <div>
          <label htmlFor="currentPassword" className="block text-text-secondary text-xs mb-1">
            Password Saat Ini
          </label>
          <input
            id="currentPassword"
            type="password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              setErrors((prev) => {
                const { currentPassword: _, ...rest } = prev;
                return rest;
              });
            }}
            className={`w-full border rounded-lg px-3 py-2 text-sm text-text focus:outline-hidden focus:ring-1 ${
              errors.currentPassword
                ? 'border-danger focus:border-danger focus:ring-[#D50000]'
                : 'border-border focus:border-[#0073E6] focus:ring-[#0073E6]'
            }`}
            placeholder="Masukkan password saat ini"
          />
          {errors.currentPassword && (
            <p className="text-danger text-xs mt-1">{errors.currentPassword}</p>
          )}
        </div>

        <div>
          <label htmlFor="newPassword" className="block text-text-secondary text-xs mb-1">
            Password Baru
          </label>
          <input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setErrors((prev) => {
                const { newPassword: _, ...rest } = prev;
                return rest;
              });
            }}
            className={`w-full border rounded-lg px-3 py-2 text-sm text-text focus:outline-hidden focus:ring-1 ${
              errors.newPassword
                ? 'border-danger focus:border-danger focus:ring-[#D50000]'
                : 'border-border focus:border-[#0073E6] focus:ring-[#0073E6]'
            }`}
            placeholder="Masukkan password baru (min. 8 karakter)"
          />
          {errors.newPassword && (
            <p className="text-danger text-xs mt-1">{errors.newPassword}</p>
          )}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-text-secondary text-xs mb-1">
            Konfirmasi Password Baru
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setErrors((prev) => {
                const { confirmPassword: _, ...rest } = prev;
                return rest;
              });
            }}
            className={`w-full border rounded-lg px-3 py-2 text-sm text-text focus:outline-hidden focus:ring-1 ${
              errors.confirmPassword
                ? 'border-danger focus:border-danger focus:ring-[#D50000]'
                : 'border-border focus:border-[#0073E6] focus:ring-[#0073E6]'
            }`}
            placeholder="Masukkan ulang password baru"
          />
          {errors.confirmPassword && (
            <p className="text-danger text-xs mt-1">{errors.confirmPassword}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || !currentPassword || !newPassword || !confirmPassword}
          className="bg-[#0073E6] text-white text-sm px-4 py-2 rounded-lg font-medium hover:bg-[#005BB5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Menyimpan...' : 'Ubah Password'}
        </button>
      </form>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SettingsSkeleton() {
  return (
    <div className="min-h-screen bg-bg-secondary pb-20">
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <div className="h-5 w-24 bg-white/20 rounded" />
      </div>
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl shadow-xs p-4">
            <div className="h-4 w-20 bg-border rounded animate-pulse mb-3" />
            <div className="h-10 w-full bg-border rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
