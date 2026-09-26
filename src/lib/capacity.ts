import { Assignment, StatusChangeCapacity } from "@/generated/prisma/client";
import { DomainError, type CapacityErrorCode } from "./domain-errors";

/**
 * The Capacity judgement: may this person act in this Capacity on this
 * Campaign or Volunteer Trip, and in which Capacity is the action recorded?
 * (CONTEXT.md, Capacity; ADR 0005.) One person may hold several
 * assignments, but every action is taken in exactly one Capacity, and on a
 * Campaign or Trip they own they act only as its Fundraiser.
 *
 * Pure: it reads nothing. A caller loads the subject under the subject
 * guard's lock (./subject-guard.ts) first, so the owner it passes in stays
 * true until its transaction commits, then asks.
 */

/** What the judgement needs of a Campaign or Volunteer Trip. */
export type CapacitySubject = { kind: "campaign" | "trip"; ownerId: string };

/** Who is acting, and the assignments they hold (ADR 0005). */
export type CapacityActor = { userId: string; assignments: readonly Assignment[] };

/** The operator capacities that are barred on a subject the person owns. */
export type OperatorCapacity =
  | typeof StatusChangeCapacity.ADMIN
  | typeof StatusChangeCapacity.VERIFIER;

/**
 * What a caller may ask for. `FUNDRAISER_OR_ADMIN` (completing a Campaign)
 * is the owner as FUNDRAISER, even holding ADMIN, or anyone else as ADMIN.
 * `VERIFIER_OR_ADMIN` (assigning a Collecting Entity, prd-compliance 10) is
 * someone holding VERIFIER as VERIFIER, else someone holding ADMIN as ADMIN,
 * never on a subject they own. SYSTEM is never asked for: no person acts as
 * the platform.
 */
export type RequestedCapacity =
  | OperatorCapacity
  | typeof StatusChangeCapacity.FUNDRAISER
  | "FUNDRAISER_OR_ADMIN"
  | "VERIFIER_OR_ADMIN";

const OPERATOR_ASSIGNMENT: Record<OperatorCapacity, Assignment> = {
  ADMIN: Assignment.ADMIN,
  VERIFIER: Assignment.VERIFIER,
};

/** Glossary names (CONTEXT.md), used as-is inside Indonesian sentences. */
const OPERATOR_LABELS: Record<OperatorCapacity, string> = {
  ADMIN: "Admin",
  VERIFIER: "Verifier",
};

const SUBJECT_LABELS: Record<CapacitySubject["kind"], string> = {
  campaign: "Campaign",
  trip: "Volunteer Trip",
};

/** The two codes of acting on your own record, one per subject kind. */
type OwnSubjectCode = Exclude<CapacityErrorCode, "NOT_AUTHORIZED">;

const OWN_SUBJECT_CODES: Record<CapacitySubject["kind"], OwnSubjectCode> = {
  campaign: "OWN_CAMPAIGN_CONFLICT",
  trip: "OWN_TRIP_CONFLICT",
};

/**
 * The actor may not act in the requested Capacity on this subject: they
 * lack the ADMIN or VERIFIER assignment it needs, or they asked to act as
 * the Fundraiser of a Campaign or Volunteer Trip they do not own. 403
 * `NOT_AUTHORIZED` through `domainErrorToHttp`, for both subjects. Also
 * re-exported from ./campaign-lifecycle-errors, where it used to live.
 */
export class NotAuthorizedError extends DomainError {
  readonly code = "NOT_AUTHORIZED";
  constructor(message = "Anda tidak berwenang melakukan tindakan ini.") {
    super(message);
    this.name = "NotAuthorizedError";
  }
}

/**
 * An Admin or Verifier tried to act in that Capacity on a Campaign or
 * Volunteer Trip they own, where they are only its Fundraiser. 403 through
 * `domainErrorToHttp`; the code names the subject, `OWN_CAMPAIGN_CONFLICT`
 * or `OWN_TRIP_CONFLICT`, as API clients have always seen it.
 */
export class OwnSubjectConflictError extends DomainError {
  readonly code: OwnSubjectCode;
  constructor(
    readonly subjectKind: CapacitySubject["kind"],
    readonly capacity: OperatorCapacity
  ) {
    const label = OPERATOR_LABELS[capacity];
    super(
      `Anda tidak dapat bertindak sebagai ${label} atas ${SUBJECT_LABELS[subjectKind]} milik Anda sendiri. Tindakan ini harus dilakukan ${label} lain.`
    );
    this.code = OWN_SUBJECT_CODES[subjectKind];
    this.name = "OwnSubjectConflictError";
  }
}

function isOperator(requested: RequestedCapacity): requested is OperatorCapacity {
  return requested === StatusChangeCapacity.ADMIN || requested === StatusChangeCapacity.VERIFIER;
}

/** The operator Capacity a request resolves to for this actor: VERIFIER_OR_ADMIN picks the one they hold. */
function operatorCapacityFor(actor: CapacityActor, requested: RequestedCapacity): OperatorCapacity | null {
  if (isOperator(requested)) return requested;
  if (requested !== "VERIFIER_OR_ADMIN") return null;
  return actor.assignments.includes(Assignment.VERIFIER)
    ? StatusChangeCapacity.VERIFIER
    : StatusChangeCapacity.ADMIN;
}

/**
 * The part of the judgement that needs nothing from the subject: an ADMIN
 * or VERIFIER request needs that assignment. A no-op for the Fundraiser
 * requests. Lets a caller refuse before it reads (or locks) anything;
 * `judgeCapacity` runs it again, with the same answer.
 */
export function requireAssignmentFor(
  actor: CapacityActor,
  requested: RequestedCapacity,
  refusal?: string
): void {
  const operator = operatorCapacityFor(actor, requested);
  if (operator && !actor.assignments.includes(OPERATOR_ASSIGNMENT[operator])) {
    throw new NotAuthorizedError(refusal);
  }
}

/**
 * The Capacity the actor acts in on this subject, or the refusal:
 * - ADMIN or VERIFIER: the matching assignment, else NotAuthorizedError;
 *   then never on their own subject, else OwnSubjectConflictError.
 * - FUNDRAISER: only the owner, else NotAuthorizedError.
 * - FUNDRAISER_OR_ADMIN: the owner as FUNDRAISER; anyone else as ADMIN,
 *   needing that assignment, else NotAuthorizedError.
 *
 * `refusal` is the NotAuthorizedError message. Left out, a FUNDRAISER
 * request is refused as "only this subject's Fundraiser may", the one
 * message every owner-only route answers with; any other request with a
 * generic one naming the subject.
 */
export function judgeCapacity(
  subject: CapacitySubject,
  actor: CapacityActor,
  requested: RequestedCapacity,
  refusal: string = defaultRefusal(subject.kind, requested)
): StatusChangeCapacity {
  const isOwner = subject.ownerId === actor.userId;
  const operator = operatorCapacityFor(actor, requested);
  if (operator) {
    requireAssignmentFor(actor, operator, refusal);
    if (isOwner) throw new OwnSubjectConflictError(subject.kind, operator);
    return operator;
  }
  if (isOwner) return StatusChangeCapacity.FUNDRAISER;
  if (requested === "FUNDRAISER_OR_ADMIN" && actor.assignments.includes(Assignment.ADMIN)) {
    return StatusChangeCapacity.ADMIN;
  }
  throw new NotAuthorizedError(refusal);
}

/**
 * "Only this subject's Fundraiser may": the NotAuthorizedError message every
 * owner-only route answers with, and the one a Fundraiser-or-Admin edit
 * route gives someone who is neither.
 */
export function fundraiserOnlyRefusal(kind: CapacitySubject["kind"]): string {
  return `Hanya Fundraiser ${SUBJECT_LABELS[kind]} ini yang dapat melakukan tindakan ini.`;
}

function defaultRefusal(kind: CapacitySubject["kind"], requested: RequestedCapacity): string {
  if (requested === StatusChangeCapacity.FUNDRAISER) return fundraiserOnlyRefusal(kind);
  return `Anda tidak berwenang melakukan tindakan ini pada ${SUBJECT_LABELS[kind]} ini.`;
}
