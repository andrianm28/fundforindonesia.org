import { AssignCollectingEntityScreen } from "@/components/collecting-entity/AssignCollectingEntityScreen";

// Rendered per request: the list changes as Collecting Entities are assigned.
export const dynamic = "force-dynamic";

/** Active Campaigns without a Collecting Entity, and where one is assigned (prd-compliance 10). */
export default function CollectingEntitiesPage() {
  return <AssignCollectingEntityScreen />;
}
