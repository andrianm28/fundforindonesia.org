import type { CampaignStatus } from "@/generated/prisma/client";
import { DomainError, type LifecycleErrorCode } from "./domain-errors";
import { STATUS_LABEL } from "./campaign-status-label";
import { deadlineRequiredMessage, KIND_LABEL, type CampaignKind } from "./campaign-kind";

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

/** The glossary name of each status, used inside the sentences below. */
export { STATUS_LABEL };

/** A required input is missing or malformed, such as a blank reason. */
export class LifecycleValidationError extends CampaignLifecycleError {
  readonly code = "VALIDATION";
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "LifecycleValidationError";
  }
}

/**
 * Missing the assignment the action needs, or not the Campaign's owner.
 * Raised by the Capacity judgement, so it lives there (./capacity.ts) and
 * is re-exported here for the lifecycle's callers.
 */
export { NotAuthorizedError } from "./capacity";

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

/**
 * A Campaign whose Kind needs a deadline (every Kind but wakaf; CONTEXT.md,
 * Campaign) has none. Raised on submission and on an edit of Kind or
 * deadline, so no such Campaign reaches a Verifier.
 */
export class DeadlineRequiredError extends CampaignLifecycleError {
  readonly code = "DEADLINE_REQUIRED";
  constructor(readonly kind: CampaignKind) {
    super(deadlineRequiredMessage(kind));
    this.name = "DeadlineRequiredError";
  }
}

// ==================== Collecting Entity (prd-compliance 10) ====================

/**
 * The Campaign names no Collecting Entity (CONTEXT.md, Collecting Entity;
 * ADR 0010): required before it may leave Draft, and before a Verifier may
 * approve it. The Fundraiser can fix it by naming one, so 422.
 */
export class CollectingEntityRequiredError extends CampaignLifecycleError {
  readonly code = "COLLECTING_ENTITY_REQUIRED";
  constructor() {
    super(
      "Campaign ini belum menyebutkan Collecting Entity. Pilih Partner Organisation yang menaunginya sebelum mengajukan."
    );
    this.name = "CollectingEntityRequiredError";
  }
}

/**
 * The Collecting Entity holds no Fundraising Permit valid now for the
 * Campaign's Kind, so the Campaign may not open (ADR 0010). Raised on
 * submission and on approval.
 */
export class FundraisingPermitRequiredError extends CampaignLifecycleError {
  readonly code = "FUNDRAISING_PERMIT_REQUIRED";
  constructor(
    readonly entityName: string,
    readonly kind: CampaignKind,
    action: "diajukan" | "diloloskan"
  ) {
    super(
      `${entityName} belum memegang Fundraising Permit yang berlaku untuk Kind ${KIND_LABEL[kind]}, sehingga Campaign ini belum dapat ${action}.`
    );
    this.name = "FundraisingPermitRequiredError";
  }
}

/**
 * The Partner Organisation named may not be this Campaign's Collecting
 * Entity: a Campaign of an organisation's linked account always collects
 * under that organisation, and an individual Fundraiser may only pick one
 * that accepts individual Campaigns. Also raised for an id that names no
 * Partner Organisation, so nothing else (the Platform Operator included)
 * can ever be named.
 */
export class CollectingEntityNotEligibleError extends CampaignLifecycleError {
  readonly code = "COLLECTING_ENTITY_NOT_ELIGIBLE";
  constructor(message: string) {
    super(message);
    this.name = "CollectingEntityNotEligibleError";
  }
}

/** An Active Campaign already names its Collecting Entity; assigning is for one that names none. */
export class CollectingEntityAlreadySetError extends CampaignLifecycleError {
  readonly code = "COLLECTING_ENTITY_ALREADY_SET";
  constructor() {
    super("Campaign ini sudah memiliki Collecting Entity.");
    this.name = "CollectingEntityAlreadySetError";
  }
}

/** A change of Collecting Entity refused because the Campaign is past Draft and Rejected. */
export class CollectingEntityNotEditableError extends CampaignLifecycleError {
  readonly code = "COLLECTING_ENTITY_NOT_EDITABLE";
  constructor(readonly currentStatus: CampaignStatus) {
    super("Collecting Entity hanya dapat diubah saat Campaign berstatus Draft atau Rejected.");
    this.name = "CollectingEntityNotEditableError";
  }
}
