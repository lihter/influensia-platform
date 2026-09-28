/**
 * Client DTO primitives. Every client-facing shape is a zod object built with `.strict()` (mechanism 2) and every
 * key is checked against the DENYLIST in tests/unit/dto-denylist.test.ts (mechanism 3). Build DTOs by hand from rows —
 * never `Dto.parse(row)` or `{...row}`.
 */
import { z } from "zod";
import { MILESTONES, LINE_STATES, LINE_EXCEPTIONS, PRICING_DISPLAYS } from "@/db/enums";

export const MoneyDto = z.object({ minor: z.number().int(), currency: z.string() }).strict();
export type MoneyDto = z.infer<typeof MoneyDto>;

/** Unit price in minor×100 (1/10,000) so `$0.0539` is exact. */
export const UnitPriceDto = z.object({ minorE2: z.number().int(), currency: z.string(), unit: z.string() }).strict();
export type UnitPriceDto = z.infer<typeof UnitPriceDto>;

export const MilestoneDto = z.enum(MILESTONES);
export const LineStateDto = z.enum(LINE_STATES);
export const ExceptionDto = z.enum(LINE_EXCEPTIONS).nullable();
export const PricingDisplayDto = z.enum(PRICING_DISPLAYS);

/** "N contacted · M quoted" travels as numbers only (SPEC 5.3). */
export const SourcingProgressDto = z.object({ reached: z.number().int().nonnegative(), priced: z.number().int().nonnegative() }).strict();
export type SourcingProgressDto = z.infer<typeof SourcingProgressDto>;

export const WaitingReasonDto = z.enum(["needs_input", "offer_sent", "sample_received", "deposit_due", "artwork_due", "balance_due", "delivery_confirm"]);
export type WaitingReasonDto = z.infer<typeof WaitingReasonDto>;

export const isoDateTime = z.string().datetime({ offset: true }).or(z.date().transform((d) => d.toISOString()));
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
