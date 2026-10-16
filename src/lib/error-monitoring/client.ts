/** Browser side: hands a caught render error to our own origin, never to a third party. */
export function sendClientError(error: Error & { digest?: string }): void {
  try {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: error.name,
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        url: window.location.pathname,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting must not make the error page itself fail.
  }
}
