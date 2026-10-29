import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import TermsPage from './terms/page';
import PrivacyPage from './privacy/page';
import { FAQAccordion } from './faq/faq-accordion';
import HelpPage from './help/page';
import { DEFAULT_SITE_SETTINGS } from '@/lib/site-settings';
import { SITE_IDENTITY } from '@/lib/site-identity';

afterEach(cleanup);

function text(node: React.ReactElement): string {
  const { container } = render(node);
  return container.textContent ?? '';
}

describe('legal pages name the operator (ADR 0009, audit L2/L8)', () => {
  it.each([
    ['Syarat & Ketentuan', TermsPage],
    ['Kebijakan Privasi', PrivacyPage],
  ])('%s names PT Jaya Korpora Prima, carries the new date, and no placeholder contact', (_name, Page) => {
    const body = text(<Page />);
    expect(body).toContain('PT Jaya Korpora Prima');
    expect(body).not.toContain('PT Fund for Indonesia');
    expect(body).toContain('Terakhir diperbarui: 16 Oktober 2026');
    expect(body).not.toContain('1234-5678');
    expect(body).not.toContain('Sudirman');
    expect(body).not.toMatch(/fundforindonesia\.id\b/);
  });

  it('Privacy names the controller and the privacy mailbox from the single constant', () => {
    const body = text(<PrivacyPage />);
    expect(body).toContain('Pengendali Data Pribadi');
    expect(body).toContain(SITE_IDENTITY.privacyEmail);
  });

  it('Privacy drops the NIK claim, names the processors, and states 10-year retention', () => {
    const body = text(<PrivacyPage />);
    expect(body).not.toMatch(/NIK|KTP/);
    expect(body).toContain('Sumopod');
    expect(body).toContain('Google');
    expect(body).toMatch(/penyedia layanan email/i);
    expect(body).toContain('10 tahun');
    expect(body).not.toContain('30 hari');
    expect(body).toMatch(/Donatur Tamu/);
    expect(body).toMatch(/Volunteer Trip/);
    expect(body).toMatch(/CSR/);
  });

  it('Privacy opens with the draft-pending-legal-review notice (audit T5)', () => {
    const body = text(<PrivacyPage />);
    expect(body).toContain('Versi draf, menunggu tinjauan penasihat hukum');
    expect(body.indexOf('Versi draf')).toBeLessThan(body.indexOf('Pendahuluan'));
  });

  it('Privacy covers processors, cross-border transfer, breach notice and UU PDP rights (audit T5)', () => {
    const body = text(<PrivacyPage />);
    expect(body).toMatch(/Pemroses Data/);
    expect(body).toMatch(/penyedia hosting/i);
    expect(body).toMatch(/Transfer Data Lintas Negara/);
    expect(body).toMatch(/Pemberitahuan Kebocoran Data/);
    expect(body).toContain('3 x 24 jam');
    expect(body).toMatch(/UU No\. 27 Tahun 2022/);
    expect(body).toContain('Unduh data saya');
    expect(body).toMatch(/Minta hapus akun/);
  });

  it('Privacy promises nothing the product does not do: no automatic deletion, no 5-year retention (audit T5)', () => {
    const body = text(<PrivacyPage />);
    expect(body).not.toMatch(/5 tahun|lima tahun/i);
    expect(body).not.toMatch(/dalam waktu \d+ hari/);
    expect(body).toMatch(/catatan keuangan tetap disimpan/i);
    expect(body).toMatch(/diproses secara manual/i);
  });

  it("Terms say the Partner Organisation is the Donor's counterparty under its own permit", () => {
    const body = text(<TermsPage />);
    expect(body).toMatch(/Lembaga Mitra yang tertera pada Kampanye adalah pihak lawan Donatur/);
    expect(body).toContain('izin penghimpunannya sendiri');
  });

  it('Terms give a refund matrix by Kind and no flat fee or open-ended discretion', () => {
    const body = text(<TermsPage />);
    expect(body).not.toContain('5%');
    expect(body).not.toContain('ditentukan oleh Kami');
    expect(body).toContain('ditampilkan pada halaman setiap Kampanye');
    expect(body).toContain('QRIS');
    expect(body).toMatch(/jumlah yang sama persis dengan yang dibayarkan/);
    expect(body).toMatch(/Wakaf:.*kegagalan teknis/);
    expect(body).toMatch(/Hibah:.*dialihkan ke Kampanye Hibah lain/);
  });
});

describe('FAQ and Help copy follows the money rules (audit L6)', () => {
  it('FAQ has no flat 5% fee, no cards or e-wallets, and says QRIS only', () => {
    const body = text(<FAQAccordion />);
    expect(body).not.toContain('5%');
    expect(body).not.toMatch(/GoPay|kartu kredit/i);
    expect(body).not.toContain('kapan saja selama kampanye berjalan');
  });

  it('Help does not say funds go out instantly or that verification is instant', () => {
    const body = text(<HelpPage />);
    expect(body).not.toContain('langsung tersalurkan ke kampanye');
    expect(body).not.toMatch(/secara instan/);
    expect(body).toContain('Verifier');
  });
});

describe('site contact defaults carry no placeholder (audit L8)', () => {
  it('uses .org mailboxes from the constant and invents no phone or address', () => {
    expect(DEFAULT_SITE_SETTINGS.contact.email).toBe(SITE_IDENTITY.contactEmail);
    expect(SITE_IDENTITY.contactEmail).toMatch(/@fundforindonesia\.org$/);
    expect(SITE_IDENTITY.privacyEmail).toMatch(/@fundforindonesia\.org$/);
    expect(DEFAULT_SITE_SETTINGS.contact.phone).toBe('');
    expect(DEFAULT_SITE_SETTINGS.contact.whatsapp).toBe('');
    expect(DEFAULT_SITE_SETTINGS.contact.address).toBe('');
    expect(JSON.stringify(DEFAULT_SITE_SETTINGS)).not.toMatch(/jutaan|terpercaya|tertinggi/);
  });
});
