import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: { program: { findMany: vi.fn(), findUnique: vi.fn() } } }));
const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: nav.refresh, push: nav.push }),
  notFound: nav.notFound,
}));

import { prisma } from '@/lib/prisma';
import AdminProgramsPage from './page';
import AdminNewProgramPage from './baru/page';
import AdminEditProgramPage from './[id]/page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const ROW = {
  id: 'p1',
  slug: 'klinik-keliling',
  title: 'Klinik Keliling',
  sector: 'HEALTH',
  problem: 'Masalah',
  beneficiaries: 'Warga',
  location: 'Pesisir',
  activities: 'Periksa',
  budget: 5000000,
  timeline: '2027',
  kpis: ['100 pasien'],
  documentation: [],
  impactReport: null,
  reportedAmount: 0,
  reportedAsOf: null,
  reportedNote: null,
};

describe('AdminProgramsPage', () => {
  it('lists Programs with Sector label and an edit link', async () => {
    vi.mocked(prisma.program.findMany).mockResolvedValue([ROW] as never);

    render(await AdminProgramsPage({}));

    expect(screen.getByRole('heading', { level: 1, name: 'Program' })).toBeDefined();
    expect(screen.getByText('Klinik Keliling')).toBeDefined();
    expect(screen.getAllByText('Kesehatan').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Ubah' })).toHaveAttribute('href', '/admin/programs/p1');
    expect(prisma.program.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { createdAt: 'desc' } });
  });

  it('narrows by Sector with parseSector and ignores an unknown one', async () => {
    vi.mocked(prisma.program.findMany).mockResolvedValue([] as never);

    render(await AdminProgramsPage({ searchParams: Promise.resolve({ sector: 'education' }) }));
    expect(prisma.program.findMany).toHaveBeenLastCalledWith({ where: { sector: 'EDUCATION' }, orderBy: { createdAt: 'desc' } });
    expect(screen.getByText('Belum ada Program.')).toBeDefined();

    await AdminProgramsPage({ searchParams: Promise.resolve({ sector: 'sports' }) });
    expect(prisma.program.findMany).toHaveBeenLastCalledWith({ where: {}, orderBy: { createdAt: 'desc' } });
  });
});

describe('AdminNewProgramPage form', () => {
  function fill() {
    fireEvent.change(screen.getByLabelText('Judul'), { target: { value: 'Sekolah Pesisir' } });
    fireEvent.change(screen.getByLabelText('Sektor'), { target: { value: 'EDUCATION' } });
    fireEvent.change(screen.getByLabelText('Masalah yang dijawab'), { target: { value: 'Putus sekolah' } });
    fireEvent.change(screen.getByLabelText('Penerima manfaat'), { target: { value: 'Anak' } });
    fireEvent.change(screen.getByLabelText('Lokasi'), { target: { value: 'Utara' } });
    fireEvent.change(screen.getByLabelText('Kegiatan'), { target: { value: 'Belajar' } });
    fireEvent.change(screen.getByLabelText('Anggaran (Rp)'), { target: { value: '1.000' } });
    fireEvent.change(screen.getByLabelText('Linimasa'), { target: { value: '2027' } });
    fireEvent.change(screen.getByLabelText('KPI (satu per baris)'), { target: { value: 'a\n\n b ' } });
  }

  it('posts the fields and returns to the list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminNewProgramPage />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Buat Program' }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/admin/programs'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/programs');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ title: 'Sekolah Pesisir', sector: 'EDUCATION', budget: 1000, kpis: ['a', 'b'] });
    expect(body.slug).toBeUndefined();
  });

  it('shows the server refusal in its own words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Sektor Program wajib diisi.' }) }));
    render(<AdminNewProgramPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Buat Program' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Sektor Program wajib diisi.');
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe('AdminEditProgramPage', () => {
  it('fills the form from the Program and PATCHes it', async () => {
    vi.mocked(prisma.program.findUnique).mockResolvedValue(ROW as never);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(await AdminEditProgramPage({ params: Promise.resolve({ id: 'p1' }) }));
    expect(screen.getByLabelText('Judul')).toHaveValue('Klinik Keliling');
    expect(screen.getByLabelText('Sektor')).toHaveValue('HEALTH');

    fireEvent.change(screen.getByLabelText('Judul'), { target: { value: 'Klinik Baru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));

    expect(await screen.findByText('Program tersimpan.')).toBeDefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/programs/p1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body).title).toBe('Klinik Baru');
  });

  it('is not found for an id no Program has', async () => {
    vi.mocked(prisma.program.findUnique).mockResolvedValue(null);
    await expect(AdminEditProgramPage({ params: Promise.resolve({ id: 'x' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
