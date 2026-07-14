/**
 * Money helpers. Money is stored and transmitted as integer **paise** everywhere
 * (never floats). ₹1 = 100 paise.
 */

/** Convert rupees to integer paise (rounded). */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Convert integer paise to a rupee number (for display/formatting only). */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/** Format paise as a localized ₹ string, e.g. 49900 -> "₹499.00". */
export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Break the GST component out of a GST-inclusive amount.
 * Prices in this system are GST-inclusive, so for an inclusive amount `A` at
 * rate `r%`, the tax portion is A * r / (100 + r).
 */
export function gstFromInclusive(inclusivePaise: number, gstRatePct: number): number {
  if (gstRatePct <= 0) return 0;
  return Math.round((inclusivePaise * gstRatePct) / (100 + gstRatePct));
}
