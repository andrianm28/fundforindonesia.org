import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { VerificationDialog } from './VerificationDialog';

// Mock next-auth/react
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: '1', name: 'Test User', email: 'test@test.com' } },
    status: 'authenticated',
    update: vi.fn().mockResolvedValue({}),
  }),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('VerificationDialog', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('renders nothing when isOpen is false', () => {
    render(<VerificationDialog isOpen={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders type selection step when opened', () => {
    render(<VerificationDialog isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Verifikasi Identitas')).toBeInTheDocument();
    expect(screen.getByText('KTP (Pribadi)')).toBeInTheDocument();
    expect(screen.getByText('Organisasi')).toBeInTheDocument();
  });

  it('navigates to KTP form when KTP option is selected', () => {
    render(<VerificationDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('KTP (Pribadi)'));
    expect(screen.getByText('Verifikasi KTP')).toBeInTheDocument();
    expect(screen.getByLabelText('Nama Lengkap')).toBeInTheDocument();
    expect(screen.getByLabelText(/NIK/)).toBeInTheDocument();
  });

  it('navigates to Organization form when Organization option is selected', () => {
    render(<VerificationDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Organisasi'));
    expect(screen.getByText('Verifikasi Organisasi')).toBeInTheDocument();
    expect(screen.getByLabelText('Nama Organisasi')).toBeInTheDocument();
    expect(screen.getByLabelText('Nomor Registrasi')).toBeInTheDocument();
  });

  it('shows validation error for short name in KTP form', async () => {
    render(<VerificationDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('KTP (Pribadi)'));

    const nameInput = screen.getByLabelText('Nama Lengkap');
    fireEvent.change(nameInput, { target: { value: 'A' } });

    const nikInput = screen.getByPlaceholderText('Masukkan 16 digit NIK');
    fireEvent.change(nikInput, { target: { value: '1234567890123456' } });

    fireEvent.click(screen.getByText('Kirim Verifikasi'));

    expect(screen.getByText('Nama minimal 2 karakter')).toBeInTheDocument();
  });

  it('shows validation error for invalid NIK (not 16 digits)', async () => {
    render(<VerificationDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('KTP (Pribadi)'));

    const nameInput = screen.getByLabelText('Nama Lengkap');
    fireEvent.change(nameInput, { target: { value: 'John Doe' } });

    const nikInput = screen.getByPlaceholderText('Masukkan 16 digit NIK');
    fireEvent.change(nikInput, { target: { value: '12345' } });

    fireEvent.click(screen.getByText('Kirim Verifikasi'));

    expect(screen.getByText('NIK harus 16 digit')).toBeInTheDocument();
  });

  it('shows validation error for short org name', async () => {
    render(<VerificationDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Organisasi'));

    const orgInput = screen.getByLabelText('Nama Organisasi');
    fireEvent.change(orgInput, { target: { value: 'A' } });

    const regInput = screen.getByLabelText('Nomor Registrasi');
    fireEvent.change(regInput, { target: { value: '12345' } });

    fireEvent.click(screen.getByText('Kirim Verifikasi'));

    expect(screen.getByText('Nama organisasi minimal 2 karakter')).toBeInTheDocument();
  });

  it('shows validation error for short registration number', async () => {
    render(<VerificationDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Organisasi'));

    const orgInput = screen.getByLabelText('Nama Organisasi');
    fireEvent.change(orgInput, { target: { value: 'My Organization' } });

    const regInput = screen.getByLabelText('Nomor Registrasi');
    fireEvent.change(regInput, { target: { value: '123' } });

    fireEvent.click(screen.getByText('Kirim Verifikasi'));

    expect(screen.getByText('Nomor registrasi minimal 5 karakter')).toBeInTheDocument();
  });

  it('submits KTP verification and shows success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { id: '1', isVerified: true, verificationType: 'ktp', role: 'CAMPAIGN_CREATOR' } }),
    });

    const onSuccess = vi.fn();
    render(<VerificationDialog isOpen={true} onClose={() => {}} onSuccess={onSuccess} />);

    // Select KTP
    fireEvent.click(screen.getByText('KTP (Pribadi)'));

    // Fill form
    fireEvent.change(screen.getByLabelText('Nama Lengkap'), { target: { value: 'John Doe' } });
    fireEvent.change(screen.getByPlaceholderText('Masukkan 16 digit NIK'), { target: { value: '1234567890123456' } });

    // Submit
    fireEvent.click(screen.getByText('Kirim Verifikasi'));

    await waitFor(() => {
      expect(screen.getByText('Verifikasi Berhasil!')).toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/user/verify', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ type: 'ktp', fullName: 'John Doe', nik: '1234567890123456' }),
    }));
    expect(onSuccess).toHaveBeenCalled();
  });

  it('submits Organization verification and shows success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { id: '1', isVerified: true, verificationType: 'organization', role: 'CAMPAIGN_CREATOR' } }),
    });

    const onSuccess = vi.fn();
    render(<VerificationDialog isOpen={true} onClose={() => {}} onSuccess={onSuccess} />);

    // Select Organization
    fireEvent.click(screen.getByText('Organisasi'));

    // Fill form
    fireEvent.change(screen.getByLabelText('Nama Organisasi'), { target: { value: 'My Foundation' } });
    fireEvent.change(screen.getByLabelText('Nomor Registrasi'), { target: { value: '12345678' } });

    // Submit
    fireEvent.click(screen.getByText('Kirim Verifikasi'));

    await waitFor(() => {
      expect(screen.getByText('Verifikasi Berhasil!')).toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/user/verify', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ type: 'organization', orgName: 'My Foundation', regNumber: '12345678' }),
    }));
    expect(onSuccess).toHaveBeenCalled();
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Terjadi kesalahan' }),
    });

    render(<VerificationDialog isOpen={true} onClose={() => {}} />);

    // Select KTP and fill
    fireEvent.click(screen.getByText('KTP (Pribadi)'));
    fireEvent.change(screen.getByLabelText('Nama Lengkap'), { target: { value: 'John Doe' } });
    fireEvent.change(screen.getByPlaceholderText('Masukkan 16 digit NIK'), { target: { value: '1234567890123456' } });
    fireEvent.click(screen.getByText('Kirim Verifikasi'));

    await waitFor(() => {
      expect(screen.getByText('Terjadi kesalahan')).toBeInTheDocument();
    });
  });

  it('calls onClose and resets state when close button is clicked', () => {
    const onClose = vi.fn();
    render(<VerificationDialog isOpen={true} onClose={onClose} />);

    // Navigate to KTP form
    fireEvent.click(screen.getByText('KTP (Pribadi)'));
    expect(screen.getByText('Verifikasi KTP')).toBeInTheDocument();

    // Close
    fireEvent.click(screen.getByLabelText('Tutup modal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('navigates back from KTP form to type selection', () => {
    render(<VerificationDialog isOpen={true} onClose={() => {}} />);

    fireEvent.click(screen.getByText('KTP (Pribadi)'));
    expect(screen.getByText('Verifikasi KTP')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Kembali'));
    expect(screen.getByText('Verifikasi Identitas')).toBeInTheDocument();
  });

  it('navigates back from Organization form to type selection', () => {
    render(<VerificationDialog isOpen={true} onClose={() => {}} />);

    fireEvent.click(screen.getByText('Organisasi'));
    expect(screen.getByText('Verifikasi Organisasi')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Kembali'));
    expect(screen.getByText('Verifikasi Identitas')).toBeInTheDocument();
  });

  it('only allows digits in NIK input', () => {
    render(<VerificationDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('KTP (Pribadi)'));

    const nikInput = screen.getByPlaceholderText('Masukkan 16 digit NIK') as HTMLInputElement;
    fireEvent.change(nikInput, { target: { value: 'abc123def456ghi7' } });

    expect(nikInput.value).toBe('1234567');
  });

  it('limits NIK input to 16 digits', () => {
    render(<VerificationDialog isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('KTP (Pribadi)'));

    const nikInput = screen.getByPlaceholderText('Masukkan 16 digit NIK') as HTMLInputElement;
    fireEvent.change(nikInput, { target: { value: '12345678901234567890' } });

    expect(nikInput.value).toBe('1234567890123456');
  });
});
