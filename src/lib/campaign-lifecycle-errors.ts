import { CampaignStatus, StatusChangeCapacity } from "@/generated/prisma/client";

/**
 * The lifecycle module's typed refusals and their one HTTP mapping. Kept
 * apart from the command module so that the subject guard
 * (./subject-guard.ts), which the commands themselves call, can raise them
 * without an import cycle. Import them from ./campaign-lifecycle, which
 * re-exports everything here.
 */
/**
 * Every refusal the lifecycle module can produce. `message` is the
 * Indonesian sentence shown to the person who acted; `code` is stable for
 * clients. `lifecycleErrorToHttp` is the one place a refusal becomes an HTTP
 * status, so every lifecycle route answers the same refusal the same way.
 */
export abstract class CampaignLifecycleError extends Error {
  abstract readonly code: LifecycleErrorCode;
}

export type LifecycleErrorCode =
  | "VALIDATION"
  | "NOT_AUTHORIZED"
  | "OWN_CAMPAIGN_CONFLICT"
  | "SAME_ADMIN_LIFT"
  | "CAMPAIGN_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "CONCURRENT_TRANSITION"
  | "PAYOUT_ALREADY_COMPLETED"
  | "CANCELLATION_ALREADY_PENDING"
  | "MISSING_CAMPAIGN_UPDATE"
  | "CANCELLATION_REQUEST_NOT_FOUND"
  | "CANCELLATION_NOT_PENDING"
  | "FLAG_NOT_FOUND"
  | "FLAG_ALREADY_RESOLVED"
  | "PAYOUT_NOT_ALLOWED_FOR_STATUS";

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

/** The operator capacities that are barred on a Campaign the person owns. */
export type OperatorCapacity =
  | typeof StatusChangeCapacity.ADMIN
  | typeof StatusChangeCapacity.VERIFIER;

const OPERATOR_LABELS: Record<OperatorCapacity, string> = {
  ADMIN: "Admin",
  VERIFIER: "Verifier",
};

/**
 * An Admin or Verifier tried to act in that role on a Campaign they own
 * (CONTEXT.md, Admin and Verifier; ADR 0005).
 */
export class OwnCampaignConflictError extends CampaignLifecycleError {
  readonly code = "OWN_CAMPAIGN_CONFLICT";
  constructor(capacity: OperatorCapacity) {
    const role = OPERATOR_LABELS[capacity];
    super(
      `Anda tidak dapat bertindak sebagai ${role} atas Campaign milik Anda sendiri. Tindakan ini harus dilakukan ${role} lain.`
    );
    this.name = "OwnCampaignConflictError";
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

const HTTP_STATUS: Record<LifecycleErrorCode, number> = {
  VALIDATION: 400,
  NOT_AUTHORIZED: 403,
  OWN_CAMPAIGN_CONFLICT: 403,
  SAME_ADMIN_LIFT: 403,
  CAMPAIGN_NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  CONCURRENT_TRANSITION: 409,
  PAYOUT_ALREADY_COMPLETED: 409,
  CANCELLATION_ALREADY_PENDING: 409,
  MISSING_CAMPAIGN_UPDATE: 422,
  CANCELLATION_REQUEST_NOT_FOUND: 404,
  CANCELLATION_NOT_PENDING: 409,
  FLAG_NOT_FOUND: 404,
  FLAG_ALREADY_RESOLVED: 409,
  PAYOUT_NOT_ALLOWED_FOR_STATUS: 409,
};

/**
 * The single mapping from a lifecycle refusal to an HTTP answer, shared by
 * every lifecycle route. Returns null for anything that is not a lifecycle
 * refusal, so the route treats it as the unexpected failure it is.
 */
export function lifecycleErrorToHttp(
  error: unknown
): { status: number; body: { error: string; code: LifecycleErrorCode } } | null {
  if (!(error instanceof CampaignLifecycleError)) return null;
  return {
    status: HTTP_STATUS[error.code],
    body: { error: error.message, code: error.code },
  };
}
