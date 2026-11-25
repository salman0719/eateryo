import { describe, expect, it } from "vitest";

import { orderSchema } from "@/features/orders/schema";
import {
  normalizePaymentStatus,
  paymentStatusLabel,
  paymentStatusTone,
  shouldShowPaymentChip,
} from "@/features/payments/status-view";

/**
 * Commit 3 slice 2: one reading of the payment state everywhere, and the
 * Order wire shape carries it without breaking payloads written before
 * payments existed.
 */

describe("payment chip helpers", () => {
  it("labels and tones every badge", () => {
    expect(paymentStatusLabel("paid")).toBe("Paid");
    expect(paymentStatusTone("paid")).toBe("success");
    expect(paymentStatusLabel("pending")).toBe("Payment pending");
    expect(paymentStatusTone("pending")).toBe("info");
    expect(paymentStatusLabel("failed")).toBe("Payment failed");
    expect(paymentStatusTone("failed")).toBe("danger");
    expect(paymentStatusLabel("refunded")).toBe("Refunded");
    expect(paymentStatusTone("refunded")).toBe("neutral");
  });

  it("treats unknown and missing states as unpaid", () => {
    expect(normalizePaymentStatus(undefined)).toBe("unpaid");
    expect(normalizePaymentStatus(null)).toBe("unpaid");
    expect(normalizePaymentStatus("nope")).toBe("unpaid");
    expect(normalizePaymentStatus("paid")).toBe("paid");
  });

  it("shows no chip on plain unpaid rows, so untouched cafés see no change", () => {
    expect(shouldShowPaymentChip({ paymentStatus: "unpaid" })).toBe(false);
    expect(shouldShowPaymentChip({})).toBe(false);
    expect(shouldShowPaymentChip({ paymentStatus: "pending" })).toBe(true);
    expect(shouldShowPaymentChip({ paymentStatus: "paid" })).toBe(true);
    expect(shouldShowPaymentChip({ paymentStatus: "unpaid", paymentProvider: "stripe" })).toBe(
      true
    );
  });
});

describe("order schema payment fields", () => {
  const base = {
    id: "order_1",
    menuId: "menu_1",
    menuTitle: "Lunch",
    tableLabel: "3",
    currency: "AUD",
    note: null,
    lines: [
      {
        menuItemId: "item_1",
        name: "Pie",
        variantName: null,
        options: [],
        unitPrice: 12,
        quantity: 1,
        menuId: "menu_1",
        menuTitle: "Lunch",
      },
    ],
    status: "new",
    createdAt: "2026-11-21T00:00:00.000Z",
    updatedAt: "2026-11-21T00:00:00.000Z",
  };

  it("parses payloads written before payments existed", () => {
    const parsed = orderSchema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it("carries the payment state when present", () => {
    const parsed = orderSchema.safeParse({
      ...base,
      paymentStatus: "pending",
      paymentProvider: "stripe",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.paymentStatus).toBe("pending");
      expect(parsed.data.paymentProvider).toBe("stripe");
    }
  });

  it("refuses unknown payment states", () => {
    expect(orderSchema.safeParse({ ...base, paymentStatus: "half-paid" }).success).toBe(false);
  });
});
