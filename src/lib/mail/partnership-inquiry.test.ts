import { describe, it, expect } from 'vitest';
import { partnershipInquiryEmail } from './partnership-inquiry';

const BASE = {
  to: 'kemitraan@contoh.test',
  companyName: 'PT Sinar Abadi',
  contactName: 'Rina Wijaya',
  contactEmail: 'rina@sinarabadi.test',
  contactPhone: '+62 812 3456 7890',
  programTitle: 'Klinik Keliling Pesisir',
  programSector: 'HEALTH',
  needs: 'Kami ingin mendanai logistic dan mobilitas tim kesehatan untuk 12 bulan.',
  inquiryUrl: 'https://fundforindonesia.org/admin/partnership-inquiries/inquiry-1',
};

describe('partnershipInquiryEmail for a new Partnership Inquiry', () => {
  const email = partnershipInquiryEmail(BASE);

  it('is addressed to the partnership team address it was given', () => {
    expect(email.to).toBe('kemitraan@contoh.test');
  });

  it('names the company and the Program in the subject', () => {
    expect(email.subject).toBe('Inquiry kemitraan baru: PT Sinar Abadi — Klinik Keliling Pesisir');
  });

  it('gives the partnership team who to reply to', () => {
    for (const body of [email.text, email.html]) {
      expect(body).toContain('Rina Wijaya');
      expect(body).toContain('rina@sinarabadi.test');
      expect(body).toContain('+62 812 3456 7890');
    }
  });

  it('carries the needs description and the Program it is about, verbatim', () => {
    for (const body of [email.text, email.html]) {
      expect(body).toContain('Kami ingin mendanai logistic dan mobilitas tim kesehatan untuk 12 bulan.');
      expect(body).toContain('Klinik Keliling Pesisir');
      expect(body).toContain('HEALTH');
    }
  });

  it('leads the partnership team to the Inquiry, not to a public page', () => {
    expect(email.text).toContain('https://fundforindonesia.org/admin/partnership-inquiries/inquiry-1');
  });

  it('says nothing about money moving, because an Inquiry moves none', () => {
    expect(email.text).not.toMatch(/donasi|transfer|pembayaran/i);
  });

  it('leaves the phone out when the company gave none', () => {
    const withoutPhone = partnershipInquiryEmail({ ...BASE, contactPhone: null });

    expect(withoutPhone.text).not.toContain('Telepon');
    expect(withoutPhone.text).toContain('rina@sinarabadi.test');
  });

  it('escapes what the company typed in the HTML body, so it cannot inject markup', () => {
    const hostile = partnershipInquiryEmail({
      ...BASE,
      companyName: '<script>alert(1)</script>',
      needs: 'Kami mau & butuh <b>anggaran</b>',
    });

    expect(hostile.html).not.toContain('<script>');
    expect(hostile.html).toContain('&lt;script&gt;');
    expect(hostile.html).toContain('&amp;');
  });

  it('keeps the subject on one line when the company name has newlines in it', () => {
    const multiline = partnershipInquiryEmail({ ...BASE, companyName: 'PT Sinar\nAbadi' });

    expect(multiline.subject).toBe('Inquiry kemitraan baru: PT Sinar Abadi — Klinik Keliling Pesisir');
  });
});
