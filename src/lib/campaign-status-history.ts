import type { CampaignStatusChangeAction, PrismaClient, StatusChangeCapacity } from '@/generated/prisma/client';

/**
 * The Campaign's status history as the moderation and admin screens show it
 * (PKS pasal 3.4): one line per CampaignStatusChange, oldest first, in the
 * words of the status labels. Staff-only: it carries who acted, in what
 * capacity and why, which no public page may show.
 */

/** What each recorded change is called on screen. A final rejection reads "Ditolak", a revisable one "Perlu revisi". */
const ACTION_LABEL: Record<Exclude<CampaignStatusChangeAction, 'SUBMISSION_REJECTED'>, string> = {
  SUBMITTED: 'Diajukan',
  SUBMISSION_APPROVED: 'Disetujui',
  SUBMISSION_WITHDRAWN: 'Pengajuan ditarik',
  COMPLETED: 'Selesai',
  SUSPENDED: 'Ditangguhkan',
  SUSPENSION_LIFTED: 'Penangguhan dicabut',
  CANCELLED: 'Ditarik',
  EXPIRED: 'Berakhir',
  URGENT_SET: 'Ditandai mendesak',
  URGENT_CLEARED: 'Tanda mendesak dicabut',
  COLLECTING_ENTITY_ASSIGNED: 'Collecting Entity ditetapkan',
};

export function statusChangeLabel(change: { action: CampaignStatusChangeAction; final: boolean }): string {
  if (change.action === 'SUBMISSION_REJECTED') return change.final ? 'Ditolak' : 'Perlu revisi';
  return ACTION_LABEL[change.action];
}

const CAPACITY_LABEL: Record<StatusChangeCapacity, string> = {
  FUNDRAISER: 'Penggalang',
  VERIFIER: 'Verifier',
  ADMIN: 'Admin',
  SYSTEM: 'Sistem',
};

export type StatusHistoryEntry = {
  id: string;
  label: string;
  /** "Penggalang", "Verifier", "Admin" or "Sistem". */
  capacity: string;
  /** Null for the System. */
  actorName: string | null;
  reason: string | null;
  at: Date;
};

/** The Campaign's changes, oldest first, ready to show to a Verifier or Admin. */
export async function loadCampaignStatusHistory(
  prisma: Pick<PrismaClient, 'campaignStatusChange'>,
  campaignId: string
): Promise<StatusHistoryEntry[]> {
  const changes = await prisma.campaignStatusChange.findMany({
    where: { campaignId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      action: true,
      final: true,
      capacity: true,
      reason: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });
  return changes.map((change) => ({
    id: change.id,
    label: statusChangeLabel(change),
    capacity: CAPACITY_LABEL[change.capacity],
    actorName: change.actor?.name ?? null,
    reason: change.reason,
    at: change.createdAt,
  }));
}
