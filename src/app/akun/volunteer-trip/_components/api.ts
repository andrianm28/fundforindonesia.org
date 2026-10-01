/**
 * The one fetch the Fundraiser's Trip forms share: JSON in, and either the
 * parsed answer or the server's own refusal text. The rules (who may, which
 * status, quotas) are the routes' and the module's, so a refusal is shown as
 * it comes rather than guessed at here. Client code: imports nothing from
 * the server.
 */
export type ApiResult = { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

export async function sendJson(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<ApiResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return { ok: true, data };
    const fieldErrors = data.fieldErrors as Record<string, string[]> | undefined;
    const detail = fieldErrors ? Object.values(fieldErrors).flat().join(' ') : '';
    const error = typeof data.error === 'string' ? data.error : 'Terjadi kesalahan.';
    return { ok: false, message: detail ? `${error} ${detail}` : error };
  } catch {
    return { ok: false, message: 'Terjadi kesalahan.' };
  }
}
