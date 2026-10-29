'use client';

import { useEffect } from 'react';
import { sendClientError } from '@/lib/error-monitoring/client';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    sendClientError(error);
  }, [error]);
  return (
    <main style={{ padding: '4rem 1rem', textAlign: 'center' }}>
      <h1>Terjadi kesalahan</h1>
      <p>Maaf, halaman ini tidak dapat ditampilkan. Tim kami sudah diberi tahu.</p>
      <button type="button" onClick={reset}>
        Coba lagi
      </button>
    </main>
  );
}
