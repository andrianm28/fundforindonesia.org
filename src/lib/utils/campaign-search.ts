export interface SearchableCampaign {
  title: string;
  description: string;
}

/**
 * Searches campaigns by matching query string (case-insensitive) against title or description.
 * Returns all campaigns that contain the query in either field.
 */
export function searchCampaigns(campaigns: SearchableCampaign[], query: string): SearchableCampaign[] {
  if (!query) return campaigns;
  const lowerQuery = query.toLowerCase();
  return campaigns.filter(
    (c) => c.title.toLowerCase().includes(lowerQuery) || c.description.toLowerCase().includes(lowerQuery)
  );
}
