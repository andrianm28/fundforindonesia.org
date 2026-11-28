# 02: Repository field kontak dan adapter Auth.js

**Blocked by:** 01

**Status:** needs-triage

- [ ] Penulisan `User`, `BankAccount`, `Donation`, `PartnershipInquiry` hanya lewat repository yang menyegel field kontak (padanan `src/lib/field-protection.ts`, ADR 0012). Tes `contact-plaintext-readers` dan `contact-fields` tetap hijau.
- [ ] Adapter Auth.js (`src/lib/auth-adapter.ts`) pindah ke `@auth/drizzle-adapter` atau adapter sendiri yang lewat repository itu; login OTP, password, dan sesi tetap lulus tes.
- [ ] Review independen `sonnet` (akses + data pribadi).
