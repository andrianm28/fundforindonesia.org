import { CampaignStatus } from "@/generated/prisma/client";
import { DomainError, type LifecycleErrorCode } from "./domain-errors";

/**
 * The lifecycle module's typed refusals. Kept apart from the command module
 * so that the subject guard (./subject-guard.ts), which the commands
 * themselves call, can raise them without an import cycle. Import them from
 * ./campaign-lifecycle, which re-exports everything here.
 *
 * Every refusal the lifecycle module can produce. `message` is the
 * Indonesian sentence shown to the person who acted; `code` is stable for
 * clients. They answer HTTP through `domainErrorToHttp` (./domain-errors.ts),
 * the one mapping the lifecycle and money routes share.
 */
export abstract class CampaignLifecycleError extends DomainError {
  abstract override readonly code: LifecycleErrorCode;
}

export { domainErrorToHttp, type LifecycleErrorCode } from "./domain-errors";

/** Glossary names (CONTEXT.md), used as-is inside Indonesian sentences. */
export const STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  REJECTED: "Rejected",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  EXPIRED: "Expired",
};

/** A required input is missing or malformed, such as a blank reason. */
export class LifecycleValidationError extends CampaignLifecycleError {
  readonly code = "VALIDATION";
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "LifecycleValidationError";
  }
}

/** Missing the assignment the action needs, or not the Campaign's owner. */
export class NotAuthorizedError extends CampaignLifecycleError {
  readonly code = "NOT_AUTHORIZED";
  constructor(message = "Anda tidak berwenang melakukan tindakan ini pada Campaign ini.") {
    super(message);
    this.name = "NotAuthorizedError";
  }
}

/** The Admin who imposed the latest Suspension tried to lift it. */
export class SameAdminLiftError extends CampaignLifecycleError {
  readonly code = "SAME_ADMIN_LIFT";
  constructor() {
    super(
      "Suspension ini harus dicabut oleh Admin lain, bukan Admin yang menjatuhkannya."
    );
    this.name = "SameAdminLiftError";
  }
}

/**
 * No Campaign matches `value`, looked up `by` its id (the commands) or its
 * slug (the HTTP adapter, before any command runs).
 */
export class CampaignNotFoundError extends CampaignLifecycleError {
  readonly code = "CAMPAIGN_NOT_FOUND";
  constructor(readonly value: string, readonly by: "id" | "slug" = "id") {
    super("Campaign tidak ditemukan.");
    this.name = "CampaignNotFoundError";
  }
}

/** The action is not legal from the Campaign's effective status. */
export class InvalidTransitionError extends CampaignLifecycleError {
  readonly code = "INVALID_TRANSITION";
  constructor(readonly currentStatus: CampaignStatus) {
    super(
      `Tindakan ini tidak dapat dilakukan pada Campaign berstatus ${STATUS_LABEL[currentStatus]}.`
    );
    this.name = "InvalidTransitionError";
  }
}

/** The predicated status write matched no row: someone else moved it first. */
export class ConcurrentTransitionError extends CampaignLifecycleError {
  readonly code = "CONCURRENT_TRANSITION";
  constructor() {
    super(
      "Status Campaign baru saja diubah oleh orang lain. Muat ulang halaman lalu periksa kembali."
    );
    this.name = "ConcurrentTransitionError";
  }
}

export class MissingCampaignUpdateError extends CampaignLifecycleError {
  readonly code = "MISSING_CAMPAIGN_UPDATE";
  constructor() {
    super(
      "Campaign harus memiliki minimal satu Campaign Update sebelum dapat ditandai Completed."
    );
    this.name = "MissingCampaignUpdateError";
  }
}

export class PayoutAlreadyCompletedError extends CampaignLifecycleError {
  readonly code = "PAYOUT_ALREADY_COMPLETED";
  constructor() {
    super(
      "Cancellation tidak dapat disetujui karena sudah ada Payout yang Completed pada Campaign ini."
    );
    this.name = "PayoutAlreadyCompletedError";
  }
}

export class CancellationAlreadyPendingError extends CampaignLifecycleError {
  readonly code = "CANCELLATION_ALREADY_PENDING";
  constructor() {
    super("Masih ada pengajuan Cancellation yang menunggu keputusan Admin.");
    this.name = "CancellationAlreadyPendingError";
  }
}
