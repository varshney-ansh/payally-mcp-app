import { Badge } from "@astryxdesign/core/Badge";
import type { Order } from "./types";

/** Format a decimal money string + currency as a localized amount. */
export function money(value: string | undefined, currency = "USD"): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value ?? "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${value} ${currency}`.trim();
  }
}

/** Format an ISO date string as a short readable date. */
export function shortDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Total item count across an order's line items. */
export function totalUnits(order: Order): number {
  return (order.items ?? []).reduce((n, i) => n + (Number(i.quantity) || 0), 0);
}

/**
 * The amount the buyer actually pays. PayPal does NOT add the platform fee into
 * its grandTotal (the fee is deducted from the merchant's proceeds), so the
 * buyer-facing total = item total + platform fee. We compute it from itemTotal
 * + platformFee rather than trusting the endpoint's grandTotal field (which
 * equals itemTotal). Returns a 2-dp decimal string.
 */
export function grandWithFee(order: Order): string {
  const items = Number(order.itemTotal);
  const fee = Number(order.platformFee ?? 0);
  const base = Number.isFinite(items) ? items : 0;
  const f = Number.isFinite(fee) ? fee : 0;
  return (base + f).toFixed(2);
}

/**
 * Status → Astryx Badge variant. COMPLETED is a positive terminal state, so it
 * uses the neutral/success treatment; pending/failed map to warning/error.
 */
export function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toUpperCase();
  const variant =
    s === "COMPLETED" || s === "CAPTURED" || s === "PAID"
      ? "success"
      : s === "PENDING" || s === "CREATED" || s === "SAVED"
        ? "warning"
        : s === "FAILED" || s === "DECLINED" || s === "VOIDED"
          ? "error"
          : "neutral";
  // Title-case the label: "COMPLETED" -> "Completed".
  const label = s.charAt(0) + s.slice(1).toLowerCase();
  return <Badge variant={variant} label={label} />;
}
