'use client';

import { STORY_MIN } from '@/lib/campaign-form';

/** The story textarea of the Campaign form (creation wizard and edit screen). */
export function CampaignStoryField({
  value,
  error,
  onChange,
}: {
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="w-full">
      <label htmlFor="campaign-story" className="block text-sm font-medium text-text mb-1.5">
        Cerita Campaign <span className="text-danger ml-0.5">*</span>
      </label>
      <textarea
        id="campaign-story"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ceritakan alasan Anda membuat penggalangan dana ini. Sertakan detail tentang siapa yang akan dibantu dan bagaimana dana akan digunakan."
        rows={8}
        className={`w-full px-3 py-2.5 text-sm rounded-md border transition-colors duration-150 resize-y focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-text-secondary/60 ${
          error
            ? 'border-danger focus:ring-danger/20 focus:border-danger'
            : 'border-border hover:border-text-secondary/50'
        }`}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <p className="mt-1 text-xs text-text-secondary">
        {value.length} karakter (minimal {STORY_MIN})
      </p>
    </div>
  );
}
