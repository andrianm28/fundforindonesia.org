/**
 * The exact signature scheme Midtrans documents for webhook notifications:
 * SHA512(order_id + status_code + gross_amount + server_key), hex-encoded.
 *
 * Built against the real documented algorithm even though only
 * MockPaymentProvider calls it today, so a real Midtrans adapter later reuses
 * this file unchanged rather than reimplementing the one piece of crypto that
 * decides whether money is real.
 */

export interface SignatureInput {
  orderId: string;
  statusCode: string;
  /** The provider's own string form, e.g. "100000.00". Signed verbatim. */
  grossAmount: string;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function computeMidtransSignature(
  input: SignatureInput,
  serverKey: string,
): Promise<string> {
  const message = `${input.orderId}${input.statusCode}${input.grossAmount}${serverKey}`;
  const digest = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(message));
  return toHex(digest);
}

/**
 * Length-checked, byte-by-byte comparison rather than `===` on the hex
 * strings. String equality short-circuits at the first differing character,
 * which leaks how much of the expected signature an attacker has guessed.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyMidtransSignature(
  input: SignatureInput,
  providedSignature: string,
  serverKey: string,
): Promise<boolean> {
  const expected = await computeMidtransSignature(input, serverKey);
  return constantTimeEqual(expected, providedSignature);
}
