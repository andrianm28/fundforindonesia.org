// @vitest-environment node
import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totpAt, verifyTotp } from "./totp";

// RFC 6238 Appendix B, SHA-1 secret "12345678901234567890", 8 digits.
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("totpAt: RFC 6238 test vectors", () => {
  for (const [seconds, expected] of RFC_VECTORS) {
    it(`T=${seconds}s gives ${expected}`, () => {
      expect(totpAt(RFC_SECRET, seconds * 1000, { digits: 8 })).toBe(expected);
    });
  }

  it("gives the last six digits at six-digit length", () => {
    expect(totpAt(RFC_SECRET, 59_000)).toBe("287082");
  });
});

describe("base32", () => {
  it("encodes the RFC 4648 vectors", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Encode(Buffer.from("fooba"))).toBe("MZXW6YTB");
    expect(base32Encode(Buffer.from("f"))).toBe("MY");
  });
  it("decodes them back, ignoring case, spaces and padding", () => {
    expect(base32Decode("mzxw 6ytb oi======").toString()).toBe("foobar");
  });
  it("refuses characters outside the alphabet", () => {
    expect(() => base32Decode("MZXW1")).toThrow();
  });
});

describe("generateTotpSecret", () => {
  it("is 160 random bits as 32 base32 characters", () => {
    const a = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(a);
  });
});

describe("verifyTotp", () => {
  const secret = base32Encode(RFC_SECRET);
  const now = 1111111109 * 1000;
  const step = Math.floor(1111111109 / 30);

  it("accepts the current code and returns its step", () => {
    expect(verifyTotp(secret, "081804", now)).toBe(step);
  });
  it("accepts one step either side", () => {
    expect(verifyTotp(secret, totpAt(RFC_SECRET, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(RFC_SECRET, now + 30_000), now)).toBe(step + 1);
  });
  it("refuses two steps away", () => {
    expect(verifyTotp(secret, totpAt(RFC_SECRET, now - 60_000), now)).toBeNull();
    expect(verifyTotp(secret, totpAt(RFC_SECRET, now + 60_000), now)).toBeNull();
  });
  it("refuses malformed codes", () => {
    for (const bad of ["", "08180", "0818045", "08180a", "      "]) {
      expect(verifyTotp(secret, bad, now)).toBeNull();
    }
  });
  it("tolerates a space in the middle, as authenticators display codes", () => {
    expect(verifyTotp(secret, "081 804", now)).toBe(step);
  });
});

describe("otpauthUri", () => {
  it("builds the Key URI an authenticator reads", () => {
    const uri = otpauthUri({ secret: "ABC234", account: "a@b.id", issuer: "Fund for Indonesia" });
    expect(uri).toBe(
      "otpauth://totp/Fund%20for%20Indonesia:a%40b.id?secret=ABC234&issuer=Fund%20for%20Indonesia&algorithm=SHA1&digits=6&period=30",
    );
  });
});
