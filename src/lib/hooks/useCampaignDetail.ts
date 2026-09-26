import useSWR from 'swr';
import type { CampaignWithRelations } from '@/types/campaign';

// GET /api/campaigns/[slug] wraps the Campaign as { campaign: {...} }.
// Returning the wrapper left the donate page reading campaign.id as
// undefined, so a donation could never name its Campaign.
const fetcher = async (url: string): Promise<CampaignWithRelations> => {
  const res = await fetch(url);
  if (!res.ok) throw new CampaignFetchError(res.status);
  const body = await res.json();
  return body.campaign;
};

/**
 * A non-2xx answer, keeping its status. A 404 means the Campaign does not
 * exist or is unapproved and not the viewer's to see (the API answers both
 * alike); that is an answer, so it is neither retried nor toasted.
 */
class CampaignFetchError extends Error {
  constructor(readonly status: number) {
    super('Gagal memuat data');
    this.name = 'CampaignFetchError';
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof CampaignFetchError && error.status === 404;
}

function showErrorToast(message: string) {
  if (typeof window !== 'undefined') {
    const event = new CustomEvent('toast', { detail: { message, type: 'error' } });
    window.dispatchEvent(event);
  }
}

export function useCampaignDetail(slug: string | null) {
  const key = slug ? `/api/campaigns/${slug}` : null;

  const { data, error, isLoading, isValidating, mutate } = useSWR<CampaignWithRelations>(
    key,
    fetcher,
    {
      revalidateOnFocus: true,
      dedupingInterval: 30000, // 30s stale time
      onError: (error) => {
        if (isNotFound(error)) return;
        showErrorToast('Gagal memuat data. Coba lagi.');
      },
      onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
        // Exponential backoff: 1s, 2s, 4s — up to 3 attempts
        if (isNotFound(error) || retryCount >= 3) return;
        setTimeout(() => revalidate({ retryCount }), Math.pow(2, retryCount) * 1000);
      },
    }
  );

  /**
   * Optimistically update campaign data after a donation.
   * Updates collectedAmount and donationCount immediately,
   * then revalidates from the server.
   */
  async function optimisticDonate(amount: number) {
    if (!data) return;

    await mutate(
      async (currentData) => {
        // After optimistic update, revalidate from server
        const res = await fetch(key!);
        if (!res.ok) return currentData;
        return (await res.json()).campaign;
      },
      {
        optimisticData: {
          ...data,
          collectedAmount: data.collectedAmount + amount,
          donations: [
            ...(data.donations || []),
            // Placeholder donation entry for count purposes
            {
              id: `optimistic-${Date.now()}`,
              amount,
              isAnonymous: false,
              paymentMethod: '',
              paymentStatus: 'pending',
              campaignId: data.id,
              donorId: null,
              createdAt: new Date(),
            } as import('@/types/donation').Donation,
          ],
        },
        rollbackOnError: true,
        revalidate: true,
      }
    );
  }

  return {
    campaign: data ?? null,
    isLoading,
    isValidating,
    error,
    notFound: isNotFound(error),
    mutate,
    optimisticDonate,
  };
}
