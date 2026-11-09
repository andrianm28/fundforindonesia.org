import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import KeamananPage from './page';

const mockUpdate = vi.fn();
const mockReplace = vi.fn();
let mfaState = 'challenge';
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    status: 'authenticated',
    data: { user: { id: 'u1', assignments: [], mfaState } },
    update: mockUpdate,
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mockReplace, push: vi.fn() }) }));

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  mockUpdate.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('/akun/keamanan (pks-pemenuhan/03)', () => {
  it('asks an enrolled Admin for a code, hands the server proof to the session, and moves on', async () => {
    mfaState = 'challenge';
    window.history.pushState({}, '', '/akun/keamanan?callbackUrl=%2Fadmin');
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/account/mfa'
        ? json(200, { state: 'challenge', enrolled: true, pending: false, backupCodesRemaining: 10 })
        : json(200, { proof: 'PROOF' }),
    );
    render(<KeamananPage />);

    fireEvent.change(await screen.findByLabelText('Kode'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verifikasi' }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/admin'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/account/mfa/verify',
      expect.objectContaining({ body: JSON.stringify({ code: '123456' }) }),
    );
    expect(mockUpdate).toHaveBeenCalledWith({ mfaProof: 'PROOF' });
  });

  it('shows the server message and does not move on when the code is refused', async () => {
    mfaState = 'challenge';
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/account/mfa'
        ? json(200, { state: 'challenge', enrolled: true, pending: false, backupCodesRemaining: 10 })
        : json(400, { error: 'Kode salah atau sudah dipakai.' }),
    );
    render(<KeamananPage />);
    fireEvent.change(await screen.findByLabelText('Kode'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verifikasi' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Kode salah atau sudah dipakai.');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('walks an unenrolled holder through setup, confirmation and the one-time backup codes', async () => {
    mfaState = 'enroll';
    let enrolled = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/account/mfa') {
        return json(200, { state: 'enroll', enrolled, pending: false, backupCodesRemaining: enrolled ? 10 : 0 });
      }
      if (url === '/api/account/mfa/setup') return json(200, { secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' });
      enrolled = true;
      return json(200, { backupCodes: ['aaaaa-bbbbb', 'ccccc-ddddd'], proof: 'P2' });
    });
    render(<KeamananPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Aktifkan' }));
    expect(await screen.findByTestId('mfa-secret')).toHaveTextContent('JBSWY3DPEHPK3PXP');
    fireEvent.change(screen.getByLabelText('Kode 6 digit'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi' }));

    expect(await screen.findByText('aaaaa-bbbbb')).toBeInTheDocument();
    expect(mockUpdate).toHaveBeenCalledWith({ mfaProof: 'P2' });
  });
});
