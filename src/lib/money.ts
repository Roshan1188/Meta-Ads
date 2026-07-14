/**
 * Money is stored and passed around as integer paise. Rupee floats accumulate
 * error, and Meta's budget fields are integer minor units anyway.
 */

export const PAISE_PER_RUPEE = 100;

/** Meta's minimum daily spend per ad set; below this the API rejects the ad set. */
export const MIN_DAILY_BUDGET_RUPEES = 100;
export const MAX_DAILY_BUDGET_RUPEES = 1_000_000;

export const rupeesToPaise = (rupees: number): number =>
  Math.round(rupees * PAISE_PER_RUPEE);

export const paiseToRupees = (paise: number): number => paise / PAISE_PER_RUPEE;

export function formatRupees(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paiseToRupees(paise));
}
