import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { PartnershipInquiryForm } from './PartnershipInquiryForm';

/**
 * The public Partnership Inquiry form (csr-04, pks-pemenuhan/17): the fields
 * of the full collaboration form, and that what the visitor fills in travels as
 * one multipart body, with the proposal PDF in it when one was chosen.
 */
let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  global.fetch = fetchMock as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('PartnershipInquiryForm (full form)', () => {
  it('asks for the budget range as a choice of ranges, the period as two months, address, NPWP and a PDF proposal', () => {
    render(<PartnershipInquiryForm programId="program-1" programSlug="klinik" />);

    const budget = screen.getByLabelText(/Kisaran anggaran/) as HTMLSelectElement;
    expect(Array.from(budget.options).map((o) => o.textContent)).toEqual([
      'Pilih kisaran anggaran',
      'Di bawah Rp50 juta',
      'Rp50 juta - Rp250 juta',
      'Rp250 juta - Rp1 miliar',
      'Di atas Rp1 miliar',
    ]);
    expect((screen.getByLabelText(/Periode mulai/) as HTMLInputElement).type).toBe('month');
    expect((screen.getByLabelText(/Periode selesai/) as HTMLInputElement).type).toBe('month');
    expect(screen.getByLabelText(/Alamat perusahaan/)).toBeTruthy();
    expect(screen.getByLabelText(/NPWP perusahaan/)).toBeTruthy();
    const proposal = screen.getByLabelText(/Proposal \(PDF/) as HTMLInputElement;
    expect(proposal.type).toBe('file');
    expect(proposal.accept).toBe('application/pdf');
  });

  it('posts the fields as one multipart body to the public route', async () => {
    render(<PartnershipInquiryForm programId="program-1" programSlug="klinik" />);
    fill('Nama perusahaan', 'PT Sinar Abadi');
    fill('Nama narahubung', 'Rina Wijaya');
    fill('Email narahubung', 'rina@sinarabadi.test');
    fill(/Kisaran anggaran/, 'FROM_50M_TO_250M');
    fill(/Periode mulai/, '2027-01');
    fill(/Periode selesai/, '2027-06');
    fill('Apa yang ingin Anda bicarakan', 'Mobilitas tim kesehatan.');

    fireEvent.submit(screen.getByRole('button', { name: 'Kirim permintaan diskusi' }).closest('form')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/partnership-inquiries');
    expect(init.method).toBe('POST');
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('programId')).toBe('program-1');
    expect(body.get('budgetRange')).toBe('FROM_50M_TO_250M');
    expect(body.get('periodStart')).toBe('2027-01');
    expect(body.get('periodEnd')).toBe('2027-06');
    // The browser sets the multipart boundary; a fixed Content-Type would break it.
    expect(init.headers).toBeUndefined();
    expect(await screen.findByTestId('inquiry-sent')).toBeTruthy();
  });

  it('puts the proposal input in the form under the name the route reads, so the PDF rides in the same body', async () => {
    render(<PartnershipInquiryForm programId="program-1" programSlug="klinik" />);
    fill('Nama perusahaan', 'PT Sinar Abadi');
    fill('Nama narahubung', 'Rina Wijaya');
    fill('Email narahubung', 'rina@sinarabadi.test');
    fill('Apa yang ingin Anda bicarakan', 'Mobilitas tim kesehatan.');
    const input = screen.getByLabelText(/Proposal \(PDF/) as HTMLInputElement;
    expect(input.name).toBe('proposal');
    expect(input.form).toBe(screen.getByRole('button', { name: 'Kirim permintaan diskusi' }).closest('form'));

    fireEvent.submit(input.form!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // With nothing chosen the browser still lists the field, as an empty file the route ignores.
    expect((fetchMock.mock.calls[0][1].body as FormData).has('proposal')).toBe(true);
  });

  it('shows the refusal the route gives, such as a proposal that is not a PDF', async () => {
    fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Proposal harus berupa berkas PDF.' }) }));
    global.fetch = fetchMock as never;
    render(<PartnershipInquiryForm programId="program-1" programSlug="klinik" />);
    fill('Nama perusahaan', 'PT Sinar Abadi');
    fill('Nama narahubung', 'Rina Wijaya');
    fill('Email narahubung', 'rina@sinarabadi.test');
    fill('Apa yang ingin Anda bicarakan', 'Mobilitas tim kesehatan.');

    fireEvent.submit(screen.getByRole('button', { name: 'Kirim permintaan diskusi' }).closest('form')!);

    expect(await screen.findByText('Proposal harus berupa berkas PDF.')).toBeTruthy();
  });
});
