import { describe, expect, it } from "vitest";
import { maskBankAccountNumber } from "./bank-account-mask";

describe("maskBankAccountNumber", () => {
  it("shows only the last 4 digits, masking the rest with a fixed-width mask", () => {
    expect(maskBankAccountNumber("1234567890")).toBe("****7890");
  });

  it("never emits a short number in full: a number no longer than the tail is masked in full", () => {
    expect(maskBankAccountNumber("1234")).toBe("****");
    expect(maskBankAccountNumber("12")).toBe("****");
    expect(maskBankAccountNumber("")).toBe("****");
  });

  it("never reveals a middle digit: the visible part is always a suffix of the input", () => {
    const number = "9988776655";
    const masked = maskBankAccountNumber(number);
    const tail = masked.replace(/^\*+/, "");
    expect(number.endsWith(tail)).toBe(true);
  });

  it("uses a fixed-width mask regardless of the account number's own length", () => {
    expect(maskBankAccountNumber("12345678901234")).toBe("****1234");
    expect(maskBankAccountNumber("123456")).toBe("****3456");
  });
});
