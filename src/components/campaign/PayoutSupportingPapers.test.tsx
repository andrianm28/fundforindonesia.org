import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PayoutSupportingPapers } from './PayoutSupportingPapers';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function ok(body: unknown = {}) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
}
function refused(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) } as Response);
}

afterEach(() => {
  cleanup();
  mockFetch.mockReset();
});

const DOC = { id: 'doc-1', label: 'Nota pembelian', contentType: 'application/pdf', sizeBytes: 10, uploadedAt: '2026-11-09T00:00:00.000Z' };

describe('PayoutSupportingPapers (PKS Pasal 4.5)', () => {
  it('lists the papers as links through the ACL route and says only the owner and Admin can open them', () => {
    render(
      <PayoutSupportingPapers payoutId="p1" status="DRAFT" note="RAB terlampir" revisionReason={null} documents={[DOC]} onChanged={vi.fn()} />,
    );

    expect(screen.getByRole('link', { name: 'Nota pembelian' }).getAttribute('href')).toBe('/api/documents/doc-1');
    expect(screen.getByText(/hanya Anda dan Admin/)).toBeDefined();
    expect(screen.getByText(/Catatan Anda: RAB terlampir/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Ajukan ulang' })).toBeNull();
  });

  it('uploads a paper with this Payout id and title, then asks the panel to reload', async () => {
    mockFetch.mockImplementation(() => ok({ document: DOC }));
    const onChanged = vi.fn();
    render(<PayoutSupportingPapers payoutId="p1" status="DRAFT" note={null} revisionReason={null} documents={[]} onChanged={onChanged} />);

    const upload = screen.getByRole('button', { name: 'Unggah dokumen' });
    expect(upload).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Nama dokumen pendukung'), { target: { value: 'Nota pembelian' } });
    fireEvent.change(screen.getByLabelText('Berkas dokumen pendukung'), {
      target: { files: [new File(['%PDF-1.7'], 'nota.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(upload);

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/documents');
    expect((init.body as FormData).get('payoutId')).toBe('p1');
    expect((init.body as FormData).get('label')).toBe('Nota pembelian');
  });

  it("shows the server's refusal of an upload", async () => {
    mockFetch.mockImplementation(() => refused(415, { error: 'Tipe berkas tidak didukung.' }));
    render(<PayoutSupportingPapers payoutId="p1" status="DRAFT" note={null} revisionReason={null} documents={[]} onChanged={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Nama dokumen pendukung'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Berkas dokumen pendukung'), { target: { files: [new File(['x'], 'x.exe')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Unggah dokumen' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Tipe berkas tidak didukung');
  });

  it('shows the Admin reason and that no money moved while in revision, and resubmits with the note', async () => {
    mockFetch.mockImplementation(() => ok({ id: 'p1', status: 'DRAFT' }));
    const onChanged = vi.fn();
    render(
      <PayoutSupportingPapers payoutId="p1" status="REVISION_REQUESTED" note="lama" revisionReason="Lampirkan RAB" documents={[]} onChanged={onChanged} />,
    );

    expect(screen.getByText(/Dana belum bergerak/)).toBeDefined();
    expect(screen.getByText(/Alasan: Lampirkan RAB/)).toBeDefined();

    fireEvent.change(screen.getByLabelText('Catatan tambahan'), { target: { value: 'RAB baru terlampir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan ulang' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/user/payouts/p1/resubmit');
    expect(JSON.parse(init.body)).toEqual({ note: 'RAB baru terlampir' });
  });
});
