'use client';

import { Input } from '@/components/ui/Input';
import { INDONESIA_PROVINCES } from '@/lib/indonesia-provinces';
import { BENEFICIARY_DESCRIPTION_MAX, REGENCY_MAX } from '@/lib/campaign-location';
import type { LocationFormErrors, LocationFormValues } from '@/lib/campaign-form';

/**
 * Where the Campaign happens and who it helps (ticket 74): province from the
 * static list, regency or city as free text, and the beneficiaries. All four
 * are optional. Shared by the creation wizard and the Draft edit screen.
 */
export function CampaignLocationFields({
  value,
  errors = {},
  onChange,
}: {
  value: LocationFormValues;
  errors?: LocationFormErrors;
  onChange: (value: LocationFormValues) => void;
}) {
  const set = (field: keyof LocationFormValues) => (next: string) => onChange({ ...value, [field]: next });

  return (
    <div className="space-y-5">
      <div className="w-full">
        <label htmlFor="campaign-province" className="block text-sm font-medium text-text mb-1.5">
          Provinsi
        </label>
        <select
          id="campaign-province"
          value={value.province}
          onChange={(e) => set('province')(e.target.value)}
          className={`w-full px-3 py-2.5 text-sm rounded-md border transition-colors duration-150 focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary ${
            errors.province ? 'border-danger focus:ring-danger/20 focus:border-danger' : 'border-border hover:border-text-secondary/50'
          }`}
        >
          <option value="">Pilih provinsi (opsional)</option>
          {INDONESIA_PROVINCES.map((province) => (
            <option key={province.code} value={province.code}>
              {province.name}
            </option>
          ))}
        </select>
        {errors.province && <p className="mt-1 text-xs text-danger">{errors.province}</p>}
      </div>

      <Input
        id="campaign-regency"
        label="Kabupaten/Kota"
        placeholder="Contoh: Kabupaten Garut"
        value={value.regency}
        onChange={set('regency')}
        error={errors.regency}
        helperText={`${value.regency.length}/${REGENCY_MAX} karakter (opsional)`}
      />

      <Input
        id="campaign-beneficiary-description"
        label="Penerima Manfaat"
        placeholder="Contoh: Anak yatim di panti asuhan"
        value={value.beneficiaryDescription}
        onChange={set('beneficiaryDescription')}
        error={errors.beneficiaryDescription}
        helperText={`${value.beneficiaryDescription.length}/${BENEFICIARY_DESCRIPTION_MAX} karakter (opsional)`}
      />

      <Input
        id="campaign-beneficiary-count"
        type="number"
        label="Jumlah Penerima Manfaat"
        placeholder="Contoh: 40"
        value={value.beneficiaryCount}
        onChange={set('beneficiaryCount')}
        error={errors.beneficiaryCount}
        helperText="Perkiraan jumlah orang yang terbantu (opsional)"
      />
    </div>
  );
}
