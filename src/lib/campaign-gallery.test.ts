import { describe, expect, it } from 'vitest';
import { galleryImagesSchema, MAX_GALLERY_IMAGES } from './campaign-gallery';

const image = (n: number) => `/uploads/lx${n}-abc${n}.jpg`;
const images = (count: number) => Array.from({ length: count }, (_, i) => image(i));

describe('galleryImagesSchema (PKS pasal 3.3)', () => {
  it('allows no images, and up to six', () => {
    expect(MAX_GALLERY_IMAGES).toBe(6);
    expect(galleryImagesSchema.safeParse([]).success).toBe(true);
    expect(galleryImagesSchema.safeParse(images(6)).success).toBe(true);
  });

  it('refuses a seventh image, saying so in Indonesian', () => {
    const result = galleryImagesSchema.safeParse(images(7));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('Galeri maksimal 6 gambar');
  });

  it('refuses the same image twice', () => {
    expect(galleryImagesSchema.safeParse([image(1), image(1)]).success).toBe(false);
  });

  it.each(['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://example.com/a.jpg', '/etc/passwd', '/uploads/../x.jpg', ' /uploads/a-b.jpg'])(
    'refuses %s, as it refuses it for a cover image',
    (bad) => {
      expect(galleryImagesSchema.safeParse([bad]).success).toBe(false);
    },
  );

  it('refuses a value that is not a list of strings', () => {
    expect(galleryImagesSchema.safeParse('/uploads/a-b.jpg').success).toBe(false);
    expect(galleryImagesSchema.safeParse([1]).success).toBe(false);
  });
});
