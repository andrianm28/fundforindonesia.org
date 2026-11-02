// One file per ADR 0024 section 5 namespace, same file set in both languages
// (src/i18n/messages.test.ts enforces identical keys and ICU arguments).
import idCommon from '@/messages/id/Common.json';
import idNav from '@/messages/id/Nav.json';
import idMetadata from '@/messages/id/Metadata.json';
import idEnums from '@/messages/id/Enums.json';
import idErrors from '@/messages/id/Errors.json';
import idHome from '@/messages/id/Home.json';
import idCampaign from '@/messages/id/Campaign.json';
import idDonation from '@/messages/id/Donation.json';
import idReceipt from '@/messages/id/Receipt.json';
import idProgram from '@/messages/id/Program.json';
import idVolunteerTrip from '@/messages/id/VolunteerTrip.json';
import idAuth from '@/messages/id/Auth.json';
import idAccount from '@/messages/id/Account.json';
import enCommon from '@/messages/en/Common.json';
import enNav from '@/messages/en/Nav.json';
import enMetadata from '@/messages/en/Metadata.json';
import enEnums from '@/messages/en/Enums.json';
import enErrors from '@/messages/en/Errors.json';
import enHome from '@/messages/en/Home.json';
import enCampaign from '@/messages/en/Campaign.json';
import enDonation from '@/messages/en/Donation.json';
import enReceipt from '@/messages/en/Receipt.json';
import enProgram from '@/messages/en/Program.json';
import enVolunteerTrip from '@/messages/en/VolunteerTrip.json';
import enAuth from '@/messages/en/Auth.json';
import enAccount from '@/messages/en/Account.json';

export const NAMESPACES = [
  'Common',
  'Nav',
  'Metadata',
  'Enums',
  'Errors',
  'Home',
  'Campaign',
  'Donation',
  'Receipt',
  'Program',
  'VolunteerTrip',
  'Auth',
  'Account',
] as const;

export const messages = {
  id: { Common: idCommon, Nav: idNav, Metadata: idMetadata, Enums: idEnums, Errors: idErrors, Home: idHome, Campaign: idCampaign, Donation: idDonation, Receipt: idReceipt, Program: idProgram, VolunteerTrip: idVolunteerTrip, Auth: idAuth, Account: idAccount },
  en: { Common: enCommon, Nav: enNav, Metadata: enMetadata, Enums: enEnums, Errors: enErrors, Home: enHome, Campaign: enCampaign, Donation: enDonation, Receipt: enReceipt, Program: enProgram, VolunteerTrip: enVolunteerTrip, Auth: enAuth, Account: enAccount },
};
