import { BankAccountRegister } from "./BankAccountRegister";

/**
 * The signed-in owner's own Bank Accounts (ticket 16; ADR 0018): add one,
 * submit it for verification, withdraw a pending submission, or delete an
 * account that has never been submitted. There is no edit control here
 * (decision 5) -- a wrong number is fixed by deleting and re-adding.
 */
export default function AkunRekeningPage() {
  return <BankAccountRegister />;
}
