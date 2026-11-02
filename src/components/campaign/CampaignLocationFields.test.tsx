import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CampaignLocationFields } from './CampaignLocationFields';
import { EMPTY_LOCATION_FORM } from '@/lib/campaign-form';

afterEach(cleanup);

describe('CampaignLocationFields', () => {
  it('offers all 38 provinces plus an empty choice, and marks nothing required', () => {
    render(<CampaignLocationFields value={EMPTY_LOCATION_FORM} onChange={() => {}} />);

    const select = screen.getByLabelText('Provinsi') as HTMLSelectElement;
    expect(select.options).toHaveLength(39);
    expect(select.value).toBe('');
    expect(screen.getByRole('option', { name: 'Jawa Barat' })).toHaveValue('32');
    expect(document.querySelector('.text-danger')).toBeNull();
  });

  it('reports each change with the other fields kept', () => {
    const onChange = vi.fn();
    render(<CampaignLocationFields value={{ ...EMPTY_LOCATION_FORM, regency: 'Garut' }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Provinsi'), { target: { value: '32' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_LOCATION_FORM, regency: 'Garut', province: '32' });

    fireEvent.change(screen.getByLabelText('Kabupaten/Kota'), { target: { value: 'Bandung' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_LOCATION_FORM, regency: 'Bandung' });

    fireEvent.change(screen.getByLabelText('Penerima Manfaat'), { target: { value: 'Anak yatim' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_LOCATION_FORM, regency: 'Garut', beneficiaryDescription: 'Anak yatim' });

    fireEvent.change(screen.getByLabelText('Jumlah Penerima Manfaat'), { target: { value: '40' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_LOCATION_FORM, regency: 'Garut', beneficiaryCount: '40' });
  });

  it('shows the given values and errors', () => {
    render(
      <CampaignLocationFields
        value={{ province: '33', regency: 'Semarang', beneficiaryDescription: 'Warga', beneficiaryCount: '7' }}
        errors={{ beneficiaryCount: 'Jumlah penerima manfaat harus bilangan bulat lebih dari 0' }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText('Provinsi')).toHaveValue('33');
    expect(screen.getByLabelText('Kabupaten/Kota')).toHaveValue('Semarang');
    expect(screen.getByLabelText('Penerima Manfaat')).toHaveValue('Warga');
    expect(screen.getByText(/harus bilangan bulat/)).toBeInTheDocument();
  });
});
