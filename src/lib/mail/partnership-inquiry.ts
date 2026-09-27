import type { MailMessage } from './types';

/**
 * What the partnership team needs in order to pick an Inquiry up: who is
 * asking, how to reach them, which Program they are asking about, and what
 * they want to discuss -- in the company's own words, not a summary of them.
 */
export type PartnershipInquiryEmailInput = {
  /** Where it goes: PARTNERSHIP_TEAM_EMAIL, resolved by the caller. */
  to: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  /** Null when the company left it out; the line is then dropped. */
  contactPhone?: string | null;
  programTitle: string;
  /** The Program's Sector value, e.g. `HEALTH` (CONTEXT.md, Sector). */
  programSector: string;
  needs: string;
  /** The partnership team's own view of the Inquiry (ticket 06). */
  inquiryUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A title on one line: a subject is a header, and a line break has no business there. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The email that tells the partnership team a company wants to discuss a
 * collaboration on a Program (CONTEXT.md, Partnership Inquiry). Indonesian, in
 * the glossary's words, and deliberately silent about money: an Inquiry asks
 * for a conversation, and the Program it is about takes none online.
 *
 * Every value typed by a person -- the company's name, the contact's name and
 * address, the needs description -- is escaped in the HTML body.
 */
export function partnershipInquiryEmail(input: PartnershipInquiryEmailInput): MailMessage {
  const contact = [
    `Perusahaan: ${input.companyName}`,
    `Nama: ${input.contactName}`,
    `Email: ${input.contactEmail}`,
    ...(input.contactPhone ? [`Telepon: ${input.contactPhone}`] : []),
  ];
  const about = [
    `Program: ${input.programTitle}`,
    `Sektor: ${input.programSector}`,
  ];
  const body = [
    'Sebuah perusahaan mengajukan Partnership Inquiry baru. Tim kemitraan perlu menindaklanjuti:',
    ...contact,
    ...about,
    'Kebutuhan yang disampaikan:',
    input.needs,
    'Buka Inquiry untuk menindaklanjuti:',
  ];
  const greeting = 'Halo Tim Kemitraan,';
  const closing = 'Salam,\nTim Fund for Indonesia';

  const text = [greeting, ...body, input.inquiryUrl, closing].join('\n\n');
  const url = escapeHtml(input.inquiryUrl);
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(body[0])}</p>`,
    ...contact.map((line) => `<p>${escapeHtml(line)}</p>`),
    ...about.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p>${escapeHtml(body[body.length - 2])}</p>`,
    // Blockquoted needs description, so the company's own words stay visibly
    // their words rather than reading as part of the platform's notice.
    `<blockquote><p>${escapeHtml(input.needs)}</p></blockquote>`,
    `<p>${escapeHtml(body[body.length - 1])}</p>`,
    `<p><a href="${url}">${url}</a></p>`,
    `<p>${escapeHtml(closing).replace('\n', '<br>')}</p>`,
  ].join('\n');

  return {
    to: input.to,
    subject: `Inquiry kemitraan baru: ${oneLine(input.companyName)} — ${oneLine(input.programTitle)}`,
    text,
    html,
  };
}
