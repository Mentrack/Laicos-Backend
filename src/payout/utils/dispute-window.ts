const HOUR_MS = 3_600_000;

/** True while the buyer can still raise a dispute (and the chat stays open). */
export function disputeWindowOpen(
  fulfilledAt: Date,
  holdHours: number,
  now: Date,
): boolean {
  return now.getTime() < fulfilledAt.getTime() + holdHours * HOUR_MS;
}
