import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs without `globals`, so Testing Library's automatic cleanup never
// registers. Without it a rendered tree stays mounted after its test, and
// React 19 can run scheduled work after jsdom is torn down ("window is not
// defined" as an unhandled error, which fails the run).
afterEach(() => {
  cleanup()
})
