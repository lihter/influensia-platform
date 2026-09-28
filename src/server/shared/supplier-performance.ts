/**
 * Supplier performance roll-up on order completion (SPEC 3.4 `delivered → completed`): orders_count+1,
 * on_time = delivered_at ≤ eta_port, last_order_at. Shared so BOTH completion paths (agent "Close" in ops/orders.ts and
 * client "Confirm delivery" in client/orders.ts) call it. Touches the supplier schema internally; returns nothing.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { orders, shipments } from "@/db/schema/app";
import { purchaseOrders, supplierPerformance } from "@/db/schema/supplier";
import { now } from "./clock";
import { isoDate } from "./dates";

export async function recordSupplierPerformance(tx: DbOrTx, orderId: string, at: Date = now()): Promise<void> {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!o) return;
  const [ship] = await tx.select().from(shipments).where(and(eq(shipments.orderId, orderId), isNull(shipments.deletedAt))).limit(1);
  const pos = await tx.select({ supplierId: purchaseOrders.supplierId }).from(purchaseOrders).where(and(eq(purchaseOrders.orderId, orderId), isNull(purchaseOrders.deletedAt)));
  const delivered = ship?.deliveredAt ?? o.deliveredAt ?? at;
  const onTime = ship?.etaPort ? isoDate(delivered)! <= ship.etaPort : null;
  for (const supplierId of [...new Set(pos.map((p) => p.supplierId))]) {
    const [perf] = await tx.select().from(supplierPerformance).where(eq(supplierPerformance.supplierId, supplierId)).limit(1);
    const count = (perf?.ordersCount ?? 0) + 1;
    const rate = onTime === null ? perf?.onTimeRate ?? null : ((perf?.onTimeRate ?? 0) * (count - 1) + (onTime ? 1 : 0)) / count;
    if (perf) await tx.update(supplierPerformance).set({ ordersCount: count, onTimeRate: rate, lastOrderAt: delivered, updatedAt: at }).where(eq(supplierPerformance.supplierId, supplierId));
    else await tx.insert(supplierPerformance).values({ supplierId, ordersCount: 1, onTimeRate: rate, lastOrderAt: delivered, updatedAt: at });
  }
}
