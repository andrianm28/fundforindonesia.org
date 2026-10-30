'use client';

/* eslint-disable @next/next/no-img-element */
import React, { useRef } from 'react';
import { coverFileError } from '@/lib/campaign-form';

/**
 * The cover image picker of the Campaign form (creation wizard and edit
 * screen). A refused file reports through `onError`; an accepted one through
 * `onPick`, and the caller keeps the preview URL.
 */
export function CoverImageField({
  preview,
  error,
  onPick,
  onError,
  onClear,
}: {
  preview: string;
  error?: string;
  onPick: (file: File) => void;
  onError: (message: string | undefined) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const refusal = coverFileError(file);
    onError(refusal);
    if (!refusal) onPick(file);
  }

  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-text mb-1.5">
        Gambar Cover <span className="text-danger ml-0.5">*</span>
      </label>
      <div
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
          error ? 'border-danger bg-danger/5' : 'border-border hover:border-primary hover:bg-primary/5'
        }`}
      >
        {preview ? (
          <div className="relative">
            <img src={preview} alt="Preview cover" className="w-full h-48 object-cover rounded-md" />
            <button
              type="button"
              aria-label="Hapus gambar cover"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="absolute top-2 right-2 bg-white/90 rounded-full p-1 hover:bg-white"
            >
              <svg className="w-4 h-4 text-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="py-8">
            <svg
              className="w-12 h-12 mx-auto text-text-secondary mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p className="text-sm text-text-secondary">Klik untuk unggah gambar cover</p>
            <p className="text-xs text-text-secondary mt-1">Format: JPG, PNG. Maks 5MB</p>
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" onChange={handlePick} className="hidden" />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
