import { describe, it, expect } from "vitest";
import { isRemoteProviderPicture, providerPicture } from "./provider-picture";

describe("isRemoteProviderPicture", () => {
  it.each([
    "https://lh3.googleusercontent.com/a/abc=s96-c",
    "https://lh4.googleusercontent.com/photo.jpg",
  ])("accepts %s", (value) => {
    expect(isRemoteProviderPicture(value)).toBe(true);
  });

  it.each([
    ["http:", "http://lh3.googleusercontent.com/a"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:image/png;base64,AAAA"],
    ["another host", "https://evil.example/a.png"],
    ["a look-alike host", "https://googleusercontent.com.evil.example/a.png"],
    ["a bare googleusercontent.com", "https://googleusercontent.com/a.png"],
    ["a local upload path", "/uploads/me.jpg"],
    ["an empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(isRemoteProviderPicture(value)).toBe(false);
  });
});

describe("providerPicture", () => {
  it("reads the picture off a Google profile", () => {
    expect(providerPicture({ sub: "g-1", picture: "https://lh3.googleusercontent.com/a" })).toBe(
      "https://lh3.googleusercontent.com/a",
    );
  });

  it.each([
    ["no profile", undefined],
    ["a null profile", null],
    ["a non-object profile", "https://lh3.googleusercontent.com/a"],
    ["a profile without a picture", { sub: "g-1" }],
    ["a non-string picture", { picture: 42 }],
    ["a picture off the allowlist", { picture: "https://evil.example/a.png" }],
  ])("is null for %s", (_label, profile) => {
    expect(providerPicture(profile)).toBeNull();
  });
});
