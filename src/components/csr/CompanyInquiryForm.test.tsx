import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CompanyInquiryForm } from './CompanyInquiryForm';

/** pks-pemenuhan/17: the Tim CSR member's form has the same extra fields and posts multipart. */
let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ inquiry: { id: 'i1', status: 'NEW', proposalStored: false } }) }));
  global.fetch = fetchMock as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CompanyInquiryForm', () => {
  it('offers budget range, period, address, NPWP and a PDF proposal', () => {
    render(<CompanyInquiryForm programs={[{ id: 'p1', title: 'Klinik' }]} />);

    expect(Array.from((screen.getByLabelText(/Kisaran anggaran/) as HTMLSelectElement).options)).toHaveLength(5);
    expect((screen.getByLabelText(/Periode mulai/) as HTMLInputElement).type).toBe('month');
    expect(screen.getByLabelText(/Alamat perusahaan/)).toBeTruthy();
    expect(screen.getByLabelText(/NPWP perusahaan/)).toBeTruthy();
    expect((screen.getByLabelText(/Proposal \(PDF/) as HTMLInputElement).accept).toBe('application/pdf');
  });

  it('posts one multipart body naming the chosen Program and the fields', async () => {
    render(<CompanyInquiryForm programs={[{ id: 'p1', title: 'Klinik' }]} />);
    fireEvent.change(screen.getByLabelText(/Kebutuhan/), { target: { value: 'Mobilitas tim kesehatan.' } });
    fireEvent.change(screen.getByLabelText(/Kisaran anggaran/), { target: { value: 'OVER_1B' } });

    fireEvent.submit(screen.getByRole('button', { name: 'Kirim Inquiry' }).closest('form')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/csr/inquiries');
    const body = init.body as FormData;
    expect(body.get('programId')).toBe('p1');
    expect(body.get('needs')).toBe('Mobilitas tim kesehatan.');
    expect(body.get('budgetRange')).toBe('OVER_1B');
    expect(init.headers).toBeUndefined();
    expect(await screen.findByRole('status')).toBeTruthy();
  });
});
