import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// The ADR 0012 field keys, as fixed test-only values. Contact details have no
// plaintext column to fall back on any more (prd-compliance 16), so anything
// that seals or reads one -- a route, a test double, the in-memory databases --
// needs the keys in the environment, and they are the same four variables the
// deployment sets. All-zero and all-one bytes: 32 of each, the size
// src/lib/field-encryption.ts insists on, and never a real key.
process.env.FIELD_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
process.env.FIELD_ENCRYPTION_KEY_ID = 'enc-test-1'
process.env.FIELD_HMAC_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE='
process.env.FIELD_HMAC_KEY_ID = 'hmac-test-1'

// Vitest runs without `globals`, so Testing Library's automatic cleanup never
// registers. Without it a rendered tree stays mounted after its test, and
// React 19 can run scheduled work after jsdom is torn down ("window is not
// defined" as an unhandled error, which fails the run).
afterEach(() => {
  cleanup()
})
