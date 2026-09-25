import useSWR from 'swr';
import type { CampaignWithCreator } from '@/types/campaign';

export interface UseCampaignsOptions {
  category?: string;
  search?: string;
  urgent?: boolean;
  page?: number;
  limit?: number;
}

export interface CampaignsResponse {
  campaigns: CampaignWithCreator[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

const fetcher = async (url: string): Promise<CampaignsResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Gagal memuat data');
  return res.json();
};

function buildQueryString(options: UseCampaignsOptions): string {
  const params = new URLSearchParams();

  if (options.category) params.set('category', options.category);
  if (options.search) params.set('search', options.search);
  if (options.urgent !== undefined) params.set('urgent', String(options.urgent));
  if (options.page !== undefined) params.set('page', String(options.page));
  if (options.limit !== undefined) params.set('limit', String(options.limit));

  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function showErrorToast(message: string) {
  if (typeof window !== 'undefined') {
    // Use a simple alert-style toast. In production, integrate with a toast library.
    const event = new CustomEvent('toast', { detail: { message, type: 'error' } });
    window.dispatchEvent(event);
  }
}

export function useCampaigns(options: UseCampaignsOptions = {}) {
  const queryString = buildQueryString(options);
  const key = `/api/campaigns${queryString}`;

  const { data, error, isLoading, isValidating, mutate } = useSWR<CampaignsResponse>(
    key,
    fetcher,
    {
      revalidateOnFocus: true,
      dedupingInterval: 30000, // 30s stale time
      onError: () => {
        showErrorToast('Gagal memuat data. Coba lagi.');
      },
      onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
        // Exponential backoff: 1s, 2s, 4s — up to 3 attempts
        if (retryCount >= 3) return;
        setTimeout(() => revalidate({ retryCount }), Math.pow(2, retryCount) * 1000);
      },
    }
  );

  return {
    campaigns: data?.campaigns ?? [],
    total: data?.total ?? 0,
    totalPages: data ? Math.ceil(data.total / data.pageSize) : 0,
    isLoading,
    isValidating,
    error,
    mutate,
  };
}
