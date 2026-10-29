'use client';

import { useEffect } from 'react';
import { sendClientError } from '@/lib/error-monitoring/client';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    sendClientError(error);
  }, [error]);
  return (
    <html lang="id">
      <body>
        <main style={{ padding: '4rem 1rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
          <h1>Terjadi kesalahan</h1>
          <p>Maaf, aplikasi tidak dapat ditampilkan. Tim kami sudah diberi tahu.</p>
          <button type="button" onClick={reset}>
            Coba lagi
          </button>
        </main>
      </body>
    </html>
  );
}
