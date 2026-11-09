import { z } from 'zod';
import { coverImageSchema } from '@/lib/cover-image';

/** At most this many gallery images beside the cover (PKS pasal 3.3); the "Campaign_galleryImages_max6" CHECK says the same. */
export const MAX_GALLERY_IMAGES = 6;

/**
 * A Campaign's gallery: up to six images, each the path /api/upload answered
 * with (or an https URL), exactly what a cover image may be, so an upload's
 * magic-byte check (src/lib/uploads.ts) is the only way a file gets in. No
 * image twice. Shared by POST /api/campaigns and PATCH /api/campaigns/[slug];
 * browser-safe.
 */
export const galleryImagesSchema = z
  .array(coverImageSchema)
  .max(MAX_GALLERY_IMAGES, `Galeri maksimal ${MAX_GALLERY_IMAGES} gambar`)
  .refine((images) => new Set(images).size === images.length, 'Gambar galeri tidak boleh sama');
