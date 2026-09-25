import { LifecycleValidationError, setUrgent } from "@/lib/campaign-lifecycle";
import { lifecycleRoute } from "@/lib/lifecycle-route";

/** An Admin sets or clears Urgent on a Campaign: `{ urgent: boolean, reason }`. */
export const PUT = lifecycleRoute({
  campaign: "slug",
  command: setUrgent,
  input: ({ body }) => {
    if (typeof body.urgent !== "boolean") {
      throw new LifecycleValidationError("Kolom urgent wajib diisi true atau false.", "urgent");
    }
    return { urgent: body.urgent, reason: body.reason };
  },
});
