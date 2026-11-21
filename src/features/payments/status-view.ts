import type { StatusTone } from "@/components/ui/status-chip";

/**
 * Commit 3 slice 2 — one reading of the payment state for every surface.
 *
 * The board chip, the diner receipt and the dev harness all go through
 * here, so "what does pending mean?" is answered once. Plain `unpaid`
 * rows show no chip: a café that never touched payments sees the board
 * exactly as today.
 */

export type PaymentBadge = "unpaid" | "pending" | "paid" | "failed" | "refunded";

export function normalizePaymentStatus(value: unknown): PaymentBadge {
  return value === "pending" || value === "paid" || value === "failed" || value === "refunded"
    ? value
    : "unpaid";
}

export function shouldShowPaymentChip(input: {
  paymentStatus?: string | null;
  paymentProvider?: string | null;
}): boolean {
  if (input.paymentProvider) return true;
  const status = normalizePaymentStatus(input.paymentStatus);
  return status !== "unpaid";
}

export function paymentStatusLabel(status: PaymentBadge): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "pending":
      return "Payment pending";
    case "failed":
      return "Payment failed";
    case "refunded":
      return "Refunded";
    case "unpaid":
    default:
      return "Unpaid";
  }
}

export function paymentStatusTone(status: PaymentBadge): StatusTone {
  switch (status) {
    case "paid":
      return "success";
    case "pending":
      return "info";
    case "failed":
      return "danger";
    case "refunded":
      return "neutral";
    case "unpaid":
    default:
      return "neutral";
  }
}
