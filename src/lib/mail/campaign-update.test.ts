import { describe, it, expect } from 'vitest';
import { campaignUpdateEmail } from './campaign-update';

const base = {
  to: 'siti@example.test',
  donorName: 'Siti',
  campaignTitle: 'Sumur Desa',
  updateTitle: 'Sumur jadi',
  updateContent: 'Dana sudah disalurkan.',
  campaignUrl: 'https://fundforindonesia.org/campaign/sumur-desa',
};

describe('campaignUpdateEmail', () => {
  it('greets by name, links the Campaign and carries the logo', () => {
    const mail = campaignUpdateEmail(base);
    expect(mail.to).toBe('siti@example.test');
    expect(mail.subject).toBe('Kabar terbaru dari "Sumur Desa"');
    expect(mail.text).toContain('Halo Siti,');
    expect(mail.text).toContain(base.campaignUrl);
    expect(mail.html).toContain('<img');
  });

  it('escapes Fundraiser-written text in the HTML and shortens a long update', () => {
    const mail = campaignUpdateEmail({
      ...base,
      updateTitle: '<script>x</script>',
      updateContent: 'a'.repeat(500),
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.text).toContain('a'.repeat(280) + '...');
    expect(mail.text).not.toContain('a'.repeat(281));
  });

  it('says why the Donor receives it', () => {
    const mail = campaignUpdateEmail(base);
    expect(mail.text).toContain('Anda menerima email ini karena Anda mendukung Campaign ini');
    expect(mail.html).toContain('karena Anda mendukung Campaign ini');
  });

  it('greets without a name when there is none', () => {
    expect(campaignUpdateEmail({ ...base, donorName: null }).text.startsWith('Halo,')).toBe(true);
  });
});
