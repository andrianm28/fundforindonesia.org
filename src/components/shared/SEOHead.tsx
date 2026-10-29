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
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}

/**
 * JSON for inside a <script> element. JSON.stringify leaves `<` as is, so a
 * value such as a Campaign title holding `</script>` would close the element
 * and the rest would run as markup. Escaping `<`, `>`, `&` and the two line
 * separators as \u sequences keeps the JSON identical once parsed.
 */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
