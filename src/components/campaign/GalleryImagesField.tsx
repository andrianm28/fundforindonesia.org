'use client';

/* eslint-disable @next/next/no-img-element */
import React, { useRef, useState } from 'react';
import { coverFileError, uploadGalleryImage } from '@/lib/campaign-form';
import { MAX_GALLERY_IMAGES } from '@/lib/campaign-gallery';

type PickedImage = { file: File; preview: string };

/**
 * The gallery of a Campaign form (PKS pasal 3.3): images already stored plus
 * files picked but not yet uploaded, at most six in all. Files go up through
 * /api/upload only when the form is saved (`resolve`), so a refused or
 * abandoned form uploads nothing.
 */
export function useGalleryDraft(initial: readonly string[] = []) {
  const [kept, setKept] = useState<string[]>([...initial]);
  const [added, setAdded] = useState<PickedImage[]>([]);
  const [error, setError] = useState<string | undefined>();

  const count = kept.length + added.length;

  function addFiles(files: File[]) {
    let room = MAX_GALLERY_IMAGES - count;
    const accepted: PickedImage[] = [];
    let refusal: string | undefined;
    for (const file of files) {
      const bad = coverFileError(file);
      if (bad) {
        refusal = bad;
        continue;
      }
      if (room <= 0) {
        refusal = `Galeri maksimal ${MAX_GALLERY_IMAGES} gambar`;
        break;
      }
      accepted.push({ file, preview: URL.createObjectURL(file) });
      room -= 1;
    }
    setError(refusal);
    if (accepted.length > 0) setAdded((current) => [...current, ...accepted]);
  }

  return {
    kept,
    added,
    error,
    count,
    addFiles,
    removeKept: (url: string) => {
      setError(undefined);
      setKept((current) => current.filter((item) => item !== url));
    },
    removeAdded: (index: number) => {
      setError(undefined);
      setAdded((current) => current.filter((_, i) => i !== index));
    },
    /** Uploads the picked files and returns the whole gallery, kept first; throws the Indonesian refusal on a failed upload. */
    resolve: async (): Promise<string[]> => {
      const uploaded: string[] = [];
      for (const picked of added) uploaded.push(await uploadGalleryImage(picked.file));
      return [...kept, ...uploaded];
    },
  };
}

export type GalleryDraft = ReturnType<typeof useGalleryDraft>;

export function GalleryImagesField({ draft }: { draft: GalleryDraft }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const full = draft.count >= MAX_GALLERY_IMAGES;

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    draft.addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  }

  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-text mb-1.5" htmlFor="gallery-input">
        Galeri Foto (opsional)
      </label>
      <p className="text-xs text-text-secondary mb-2">
        Maksimal {MAX_GALLERY_IMAGES} gambar tambahan. Format: JPG, PNG, WebP. Maks 5MB per gambar. ({draft.count}/{MAX_GALLERY_IMAGES})
      </p>
      {draft.count > 0 && (
        <ul className="grid grid-cols-3 gap-2 mb-2">
          {draft.kept.map((url) => (
            <li key={url} className="relative">
              <img src={url} alt="Gambar galeri" className="w-full h-24 object-cover rounded-md" />
              <RemoveButton label="Hapus gambar galeri" onClick={() => draft.removeKept(url)} />
            </li>
          ))}
          {draft.added.map((picked, index) => (
            <li key={picked.preview} className="relative">
              <img src={picked.preview} alt="Gambar galeri baru" className="w-full h-24 object-cover rounded-md" />
              <RemoveButton label="Hapus gambar galeri baru" onClick={() => draft.removeAdded(index)} />
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={full}
        className="text-sm font-medium text-primary border border-primary rounded-lg px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Tambah gambar galeri
      </button>
      <input
        id="gallery-input"
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handlePick}
        className="hidden"
      />
      {draft.error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {draft.error}
        </p>
      )}
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="absolute top-1 right-1 bg-white/90 rounded-full p-1 hover:bg-white"
    >
      <svg className="w-3 h-3 text-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}
