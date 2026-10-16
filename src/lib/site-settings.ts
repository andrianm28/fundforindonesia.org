import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { SITE_IDENTITY } from "@/lib/site-identity";

/**
 * Pengaturan Laman Publik: the public-page content an Admin edits from the
 * panel, and the only place its shape and its defaults are written down.
 *
 * Five sections, one row each in SiteSetting (key = section name):
 *   contact  email, phone, WhatsApp, office hours and address (Kontak page)
 *   social   Instagram / Twitter / Facebook URLs (footer, Kontak page)
 *   footer   the "Tentang" paragraph in the footer
 *   hero     the homepage banner slides
 *   pages    copy of the Tentang Kami page and the Media / Karir contact emails
 *
 * Public content only. Payment providers, fees, thresholds and anything
 * secret have their own Admin screens and never pass through here.
 *
 * Nothing is seeded: with no row for a section, DEFAULT_SITE_SETTINGS (the
 * text the pages carried before they were editable) is what visitors see, the
 * same way an unset Abuse Threshold resolves to the PRD's number. A stored row
 * that no longer parses (a schema change, a hand edit) also falls back to the
 * default for that section rather than breaking the page.
 */

/** An https URL or a site-relative path: never javascript:, data: or http:. */
const linkTarget = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^\/(?!\/)/.test(v) || /^https:\/\//i.test(v), {
    message: "Harus berupa alamat https:// atau path yang diawali /.",
  });

/** An https URL, or empty to hide the link. */
const optionalHttpsUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), { message: "Harus berupa alamat https:// atau dikosongkan." });

const email = z
  .string()
  .trim()
  .max(200)
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: "Alamat email tidak valid." });

/** A phone number as shown to visitors; digits, spaces and + ( ) - . only. */
const phone = z
  .string()
  .trim()
  .max(40)
  .refine((v) => v === "" || (/^[\d\s+()\-.]+$/.test(v) && v.replace(/\D/g, "").length >= 6), {
    message: "Nomor telepon tidak valid, atau kosongkan untuk menyembunyikan.",
  });

export const SITE_SETTING_SCHEMAS = {
  contact: z.object({
    email,
    phone,
    whatsapp: phone,
    hours: z.string().trim().max(200),
    address: z.string().trim().max(500),
  }),
  social: z.object({
    instagram: optionalHttpsUrl,
    twitter: optionalHttpsUrl,
    facebook: optionalHttpsUrl,
  }),
  footer: z.object({
    about: z.string().trim().min(1, "Teks tidak boleh kosong.").max(1000),
  }),
  hero: z.object({
    slides: z
      .array(
        z.object({
          image: linkTarget,
          headline: z.string().trim().min(1, "Judul tidak boleh kosong.").max(160),
          ctaLabel: z.string().trim().min(1, "Label tombol tidak boleh kosong.").max(40),
          ctaHref: linkTarget,
        }),
      )
      .min(1, "Minimal satu slide.")
      .max(8, "Maksimal delapan slide."),
  }),
  pages: z.object({
    aboutParagraphs: z.array(z.string().trim().min(1, "Paragraf tidak boleh kosong.").max(2000)).min(1).max(10),
    pressEmail: email,
    careersEmail: email,
  }),
} as const;

export type SiteSettingKey = keyof typeof SITE_SETTING_SCHEMAS;
export const SITE_SETTING_KEYS = Object.keys(SITE_SETTING_SCHEMAS) as SiteSettingKey[];

export type SiteSettings = { [K in SiteSettingKey]: z.infer<(typeof SITE_SETTING_SCHEMAS)[K]> };

/** What the pages said before they were editable. */
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  contact: {
    email: SITE_IDENTITY.contactEmail,
    // Telepon, WhatsApp, jam layanan, dan alamat kosong sampai owner memberi nilai nyata (L8);
    // halaman Kontak menyembunyikan bagian yang kosong.
    phone: "",
    whatsapp: "",
    hours: "",
    address: "",
  },
  social: {
    instagram: "https://instagram.com/fundforindonesia",
    twitter: "https://twitter.com/fundforindonesia",
    facebook: "https://facebook.com/fundforindonesia",
  },
  footer: {
    about:
      `Fund for Indonesia adalah platform teknologi untuk donasi dan penggalangan dana online di Indonesia, dioperasikan oleh ${SITE_IDENTITY.operatorName}.`,
  },
  hero: {
    slides: [
      {
        image: "/images/hero/banner-1.jpg",
        headline: "Bantu mereka yang membutuhkan, salurkan donasimu sekarang",
        ctaLabel: "Donasi Sekarang",
        ctaHref: "/explore/all",
      },
      {
        image: "/images/hero/banner-3.jpg",
        headline: "Galang dana untuk kebaikan bersama Fund for Indonesia",
        ctaLabel: "Galang Dana",
        ctaHref: "/campaign/create",
      },
    ],
  },
  pages: {
    aboutParagraphs: [
      "Fund for Indonesia adalah platform penggalangan dana online yang didedikasikan untuk membantu masyarakat Indonesia dalam mengumpulkan dana untuk berbagai kebutuhan sosial, kesehatan, pendidikan, dan kemanusiaan. Kami percaya bahwa setiap orang memiliki kekuatan untuk membuat perubahan positif di lingkungan sekitarnya.",
      "Didirikan dengan visi untuk menjadi jembatan antara mereka yang membutuhkan bantuan dan mereka yang ingin membantu, platform kami menyediakan infrastruktur teknologi yang aman, transparan, dan mudah digunakan. Setiap Campaign ditinjau oleh Verifier sebelum terbit dan menyebut lembaga yang menghimpun dananya.",
      "Kami berusaha menjaga kepercayaan donatur dengan menampilkan angka penghimpunan dan penyaluran dana di halaman Impact & Transparansi.",
    ],
    pressEmail: "press@fundforindonesia.org",
    careersEmail: "careers@fundforindonesia.org",
  },
};

export class InvalidSiteSettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSiteSettingError";
  }
}

type SettingDb = Pick<PrismaClient, "siteSetting">;

export function isSiteSettingKey(key: unknown): key is SiteSettingKey {
  return typeof key === "string" && (SITE_SETTING_KEYS as string[]).includes(key);
}

/** Every section as visitors see it: the stored row if it parses, else the default. */
export async function resolveSiteSettings(db: SettingDb): Promise<SiteSettings> {
  const rows = await db.siteSetting.findMany();
  const resolved: SiteSettings = structuredClone(DEFAULT_SITE_SETTINGS);
  for (const row of rows) {
    if (!isSiteSettingKey(row.key)) continue;
    const parsed = SITE_SETTING_SCHEMAS[row.key].safeParse(row.value);
    if (parsed.success) (resolved as Record<string, unknown>)[row.key] = parsed.data;
  }
  return resolved;
}

/**
 * The same read for a public page: a database that cannot be reached must not
 * take the footer, the contact page or the homepage down with it, so a failure
 * shows the defaults.
 */
export async function resolveSiteSettingsOrDefaults(db: SettingDb): Promise<SiteSettings> {
  try {
    return await resolveSiteSettings(db);
  } catch {
    return structuredClone(DEFAULT_SITE_SETTINGS);
  }
}

/** An Admin replaces one section. Validated here, so the route and any later caller agree. */
export async function setSiteSetting(
  db: SettingDb,
  params: { key: unknown; value: unknown; actorId: string },
): Promise<{ key: SiteSettingKey; value: unknown }> {
  const { key } = params;
  if (!isSiteSettingKey(key)) {
    throw new InvalidSiteSettingError(`Pengaturan tidak dikenal. Pilih salah satu dari: ${SITE_SETTING_KEYS.join(", ")}.`);
  }
  const parsed = SITE_SETTING_SCHEMAS[key].safeParse(params.value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first.path.length > 0 ? ` (${first.path.join(".")})` : "";
    throw new InvalidSiteSettingError(`${first.message}${where}`);
  }
  const value = parsed.data as Prisma.InputJsonValue;
  await db.siteSetting.upsert({
    where: { key },
    create: { key, value, updatedById: params.actorId },
    update: { value, updatedById: params.actorId },
  });
  return { key, value: parsed.data };
}

export function siteSettingErrorToHttp(error: unknown): { status: number; error: string } | null {
  if (error instanceof InvalidSiteSettingError) return { status: 400, error: error.message };
  return null;
}

/** The digits of a phone number as a dialling target: +62 for a leading 0. */
export function dialTarget(display: string): string {
  const digits = display.replace(/\D/g, "");
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

/** "@name" from a profile URL, or the host when the URL has no path. */
export function socialHandle(url: string): string {
  try {
    const u = new URL(url);
    const first = u.pathname.split("/").filter(Boolean)[0];
    return first ? `@${first}` : u.hostname;
  } catch {
    return url;
  }
}
