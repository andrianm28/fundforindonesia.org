export interface StructuredDataProps {
  data: Record<string, unknown>;
}

/**
 * StructuredData component for rendering JSON-LD structured data in page components.
 * Used for SEO rich results (DonateAction, Organization, etc.)
 */
export function StructuredData({ data }: StructuredDataProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
