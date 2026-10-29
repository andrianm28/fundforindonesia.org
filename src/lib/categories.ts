/**
 * The Category list (PRD "Category Campaign dikelola Admin dari panel"). A
 * Campaign names its Category by slug in a free-text column, so the Category
 * table is the one list that column is checked against: the create form reads
 * it, POST /api/campaigns refuses a slug that is not in it, and the Admin
 * Kategori screen edits it. The slug never changes after creation, because
 * Campaigns, fee overrides and Escrow Hold overrides all point at it.
 */

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME = 80;
const MAX_ICON = 16;

/** The few Prisma methods this module needs, so tests need no database. */
export interface CategoryDb {
  category: {
    findUnique(args: { where: { slug: string } }): Promise<{ id: string; slug: string } | null>;
  };
}

export type CategoryInput = { name: string; slug: string; icon: string; order: number };

export type CategoryCheck<T> = { ok: true; value: T } | { ok: false; error: string };

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function checkName(raw: unknown): CategoryCheck<string> {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: 'Nama kategori harus diisi.' };
  if (raw.trim().length > MAX_NAME) return { ok: false, error: `Nama kategori maksimal ${MAX_NAME} karakter.` };
  return { ok: true, value: raw.trim() };
}

function checkIcon(raw: unknown): CategoryCheck<string> {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: 'Ikon kategori harus diisi.' };
  if (raw.trim().length > MAX_ICON) return { ok: false, error: `Ikon kategori maksimal ${MAX_ICON} karakter.` };
  return { ok: true, value: raw.trim() };
}

function checkOrder(raw: unknown): CategoryCheck<number> {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 10000) {
    return { ok: false, error: 'Urutan harus berupa bilangan bulat 0 sampai 10000.' };
  }
  return { ok: true, value: raw };
}

export function checkSlug(raw: unknown): CategoryCheck<string> {
  if (typeof raw !== 'string' || raw === '') return { ok: false, error: 'Slug harus diisi.' };
  if (raw.length > MAX_NAME || !SLUG_PATTERN.test(raw)) {
    return { ok: false, error: 'Slug hanya boleh huruf kecil a-z, angka 0-9 dan tanda hubung (-).' };
  }
  return { ok: true, value: raw };
}

/** A new Category: name, slug and icon are required; order defaults to 0. */
export function parseNewCategory(raw: unknown): CategoryCheck<CategoryInput> {
  const body = asObject(raw);
  if (!body) return { ok: false, error: 'Body permintaan harus berupa objek JSON.' };
  const name = checkName(body.name);
  if (!name.ok) return name;
  const slug = checkSlug(body.slug);
  if (!slug.ok) return slug;
  const icon = checkIcon(body.icon);
  if (!icon.ok) return icon;
  let order = 0;
  if (body.order !== undefined) {
    const checked = checkOrder(body.order);
    if (!checked.ok) return checked;
    order = checked.value;
  }
  return { ok: true, value: { name: name.value, slug: slug.value, icon: icon.value, order } };
}

/** A rename or re-sort: any of name, icon, order. The slug cannot be sent. */
export function parseCategoryChange(raw: unknown): CategoryCheck<Partial<Omit<CategoryInput, 'slug'>>> {
  const body = asObject(raw);
  if (!body) return { ok: false, error: 'Body permintaan harus berupa objek JSON.' };
  if (body.slug !== undefined) {
    return { ok: false, error: 'Slug tidak dapat diubah: Campaign merujuk kategori lewat slug.' };
  }
  const change: Partial<Omit<CategoryInput, 'slug'>> = {};
  if (body.name !== undefined) {
    const name = checkName(body.name);
    if (!name.ok) return name;
    change.name = name.value;
  }
  if (body.icon !== undefined) {
    const icon = checkIcon(body.icon);
    if (!icon.ok) return icon;
    change.icon = icon.value;
  }
  if (body.order !== undefined) {
    const order = checkOrder(body.order);
    if (!order.ok) return order;
    change.order = order.value;
  }
  if (Object.keys(change).length === 0) return { ok: false, error: 'Tidak ada perubahan yang dikirim.' };
  return { ok: true, value: change };
}

export const UNKNOWN_CATEGORY_MESSAGE = 'Kategori tidak dikenal. Pilih salah satu kategori yang tersedia.';

/** Whether a Campaign may name this Category slug. */
export async function categoryExists(db: CategoryDb, slug: string): Promise<boolean> {
  return (await db.category.findUnique({ where: { slug } })) !== null;
}
