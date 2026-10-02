import { z } from 'zod';
import { MAX_RUPIAH_AMOUNT } from '@/lib/money/ledger';

/**
 * What the public Volunteer Trip routes may expose (ticket 54). Explicit
 * allow-lists: a column added to the model later stays private until it is
 * listed here. Never listed: fundraiserId / fundraiser (internal user id),
 * updatedAt. Batch: minQuota and the timestamps stay internal.
 */
export const PUBLIC_TRIP_LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  description: true,
  coverImage: true,
  destination: true,
  tripFeeAmount: true,
  createdAt: true,
} as const;

export const PUBLIC_TRIP_DETAIL_SELECT = {
  ...PUBLIC_TRIP_LIST_SELECT,
  story: true,
  itinerary: true,
  status: true,
} as const;

export const PUBLIC_BATCH_SELECT = {
  id: true,
  tripId: true,
  startDate: true,
  endDate: true,
  registrationDeadline: true,
  maxQuota: true,
  status: true,
} as const;

/** Whole Rupiah only, positive, within the Int column (same bound as the ledger). */
export const tripFeeAmountSchema = z
  .number()
  .int('Trip Fee harus bilangan bulat Rupiah')
  .positive('Trip Fee harus lebih dari 0')
  .max(MAX_RUPIAH_AMOUNT, 'Trip Fee terlalu besar');
