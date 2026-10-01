/**
 * Screen labels for Volunteer Trip and Batch statuses, Indonesian as the
 * Campaign Status badge is (CONTEXT.md, Campaign Status). Plain strings, so
 * client and server code may both import it.
 */
export const TRIP_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draf',
  SUBMITTED: 'Diajukan',
  REJECTED: 'Ditolak',
  ACTIVE: 'Aktif',
  SUSPENDED: 'Dibekukan',
  CANCELLED: 'Ditarik',
  COMPLETED: 'Selesai',
};

export const BATCH_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Terbuka',
  CLOSED: 'Ditutup',
  CANCELLED: 'Dibatalkan',
  COMPLETED: 'Selesai',
};
