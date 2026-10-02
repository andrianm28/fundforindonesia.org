import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const refresh = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push }) }));

import { BatchActions } from './BatchActions';
import { BatchForm } from './BatchForm';
import { SubmitTripButton } from './SubmitTripButton';

const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

const VALUES = {
  startDate: '2026-12-01',
  endDate: '2026-12-05',
  registrationDeadline: '2026-11-20',
  maxQuota: 10,
  minQuota: 2,
};
const ROSTER = [
  { id: 'r1', name: 'Budi' },
  { id: 'r2', name: 'Sari' },
  { id: 'r3', name: 'Joko' },
];

const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);

describe('Fundraiser Trip client components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as never;
  });
  afterEach(cleanup);

  describe('BatchActions: complete', () => {
    const renderActions = (ended = true) =>
      render(<BatchActions slug="sumba" batchId="b1" values={VALUES} ended={ended} roster={ROSTER} seatsUsed={0} />);

    it('sends every Registration id when nobody is unticked', async () => {
      answer(200, { batch: { id: 'b1', status: 'COMPLETED' } });
      renderActions();
      fireEvent.click(screen.getByRole('button', { name: 'Selesaikan Batch' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(fetchMock.mock.calls[0][0]).toBe('/api/volunteer-trips/sumba/batches/b1');
      expect(lastBody()).toEqual({ action: 'complete', attendedRegistrationIds: ['r1', 'r2', 'r3'] });
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('leaves an unticked Volunteer out of the list', async () => {
      answer(200, { batch: {} });
      renderActions();
      fireEvent.click(screen.getByLabelText('Sari'));
      fireEvent.click(screen.getByRole('button', { name: 'Selesaikan Batch' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(lastBody().attendedRegistrationIds).toEqual(['r1', 'r3']);
    });

    it('can complete with nobody attending (an empty list, not a missing one)', async () => {
      answer(200, { batch: {} });
      renderActions();
      for (const name of ['Budi', 'Sari', 'Joko']) fireEvent.click(screen.getByLabelText(name));
      fireEvent.click(screen.getByRole('button', { name: 'Selesaikan Batch' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(lastBody()).toEqual({ action: 'complete', attendedRegistrationIds: [] });
    });

    it('will not complete before the end date', () => {
      renderActions(false);
      expect((screen.getByRole('button', { name: 'Selesaikan Batch' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows the server refusal as it comes, and does not refresh', async () => {
      answer(403, { error: 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.' });
      renderActions();
      fireEvent.click(screen.getByRole('button', { name: 'Selesaikan Batch' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Hanya Fundraiser Volunteer Trip ini');
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe('BatchActions: cancel', () => {
    it('posts the cancel action', async () => {
      answer(200, { batch: {}, refundedRegistrations: [] });
      render(<BatchActions slug="sumba" batchId="b1" values={VALUES} ended={false} roster={ROSTER} seatsUsed={0} />);
      fireEvent.click(screen.getByRole('button', { name: 'Batalkan Batch' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(lastBody()).toEqual({ action: 'cancel' });
    });

    it('shows the server\'s reason when the minimum quota was reached', async () => {
      answer(400, { error: 'Kuota minimum sudah tercapai', code: 'BATCH_MIN_QUOTA_MET' });
      render(<BatchActions slug="sumba" batchId="b1" values={VALUES} ended={false} roster={ROSTER} seatsUsed={0} />);
      fireEvent.click(screen.getByRole('button', { name: 'Batalkan Batch' }));
      expect((await screen.findByRole('alert')).textContent).toBe('Kuota minimum sudah tercapai');
    });
  });

  describe('BatchForm', () => {
    it('adds a Batch, sending WIB-bounded instants and numeric quotas', async () => {
      answer(201, { id: 'b9' });
      render(<BatchForm slug="sumba" seatsUsed={0} />);
      fireEvent.change(screen.getByLabelText('Tanggal mulai'), { target: { value: '2026-12-01' } });
      fireEvent.change(screen.getByLabelText('Tanggal selesai'), { target: { value: '2026-12-05' } });
      fireEvent.change(screen.getByLabelText('Tenggat pendaftaran'), { target: { value: '2026-11-20' } });
      fireEvent.change(screen.getByLabelText('Kuota maksimum'), { target: { value: '12' } });
      fireEvent.change(screen.getByLabelText('Kuota minimum'), { target: { value: '4' } });
      fireEvent.click(screen.getByRole('button', { name: 'Tambah Batch' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(fetchMock.mock.calls[0][0]).toBe('/api/volunteer-trips/sumba/batches');
      expect(fetchMock.mock.calls[0][1].method).toBe('POST');
      expect(lastBody()).toEqual({
        startDate: '2026-11-30T17:00:00.000Z',
        endDate: '2026-12-05T16:59:59.000Z',
        registrationDeadline: '2026-11-20T16:59:59.000Z',
        maxQuota: 12,
        minQuota: 4,
      });
    });

    it('edits an existing Batch with PATCH and shows a field refusal', async () => {
      answer(400, {
        error: 'Tanggal selesai tidak boleh sebelum tanggal mulai.',
        fieldErrors: { endDate: ['Tanggal selesai tidak boleh sebelum tanggal mulai.'] },
      });
      render(<BatchForm slug="sumba" batchId="b1" initial={VALUES} seatsUsed={0} />);
      fireEvent.click(screen.getByRole('button', { name: 'Simpan Batch' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(fetchMock.mock.calls[0][0]).toBe('/api/volunteer-trips/sumba/batches/b1');
      expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
      // One message, in Indonesian with the form's own labels, not the field name, and not twice.
      expect((await screen.findByRole('alert')).textContent).toBe('Tanggal selesai tidak boleh sebelum tanggal mulai.');
    });
  });

  describe('BatchForm with seats taken (ticket 48)', () => {
    it('shows the dates read-only with the reason, and sends only the quotas', async () => {
      answer(200, { batch: {} });
      render(<BatchForm slug="sumba" batchId="b1" initial={VALUES} seatsUsed={3} />);
      expect((screen.getByLabelText('Tanggal mulai') as HTMLInputElement).readOnly).toBe(true);
      expect((screen.getByLabelText('Tanggal selesai') as HTMLInputElement).readOnly).toBe(true);
      expect((screen.getByLabelText('Tenggat pendaftaran') as HTMLInputElement).readOnly).toBe(true);
      expect((screen.getByLabelText('Kuota maksimum') as HTMLInputElement).min).toBe('3');
      expect(screen.getByText(/Tanggal Batch dikunci/)).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Simpan Batch' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(Object.keys(lastBody() as object).sort()).toEqual(['maxQuota', 'minQuota']);
    });

    it('keeps the dates editable while no one has registered', () => {
      render(<BatchForm slug="sumba" batchId="b1" initial={VALUES} seatsUsed={0} />);
      expect((screen.getByLabelText('Tanggal mulai') as HTMLInputElement).readOnly).toBe(false);
      expect(screen.queryByText(/Tanggal Batch dikunci/)).toBeNull();
    });
  });

  describe('SubmitTripButton', () => {
    it('submits the Trip and refreshes', async () => {
      answer(200, { trip: {} });
      render(<SubmitTripButton slug="sumba" />);
      fireEvent.click(screen.getByRole('button', { name: 'Ajukan ke Verifier' }));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(fetchMock.mock.calls[0][0]).toBe('/api/volunteer-trips/sumba');
      expect(lastBody()).toEqual({ action: 'submit' });
    });

    it('shows the server refusal', async () => {
      answer(409, { error: 'Volunteer Trip tidak bisa diedit pada status ini' });
      render(<SubmitTripButton slug="sumba" />);
      fireEvent.click(screen.getByRole('button', { name: 'Ajukan ke Verifier' }));
      expect((await screen.findByRole('alert')).textContent).toContain('tidak bisa diedit');
    });
  });
});
