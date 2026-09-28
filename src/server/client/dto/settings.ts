import { z } from "zod";
import { isoDateTime } from "./common";

/**
 * /app/settings (SPEC F-01 self-service). The company block is display-only for the client; the word "organisation" never
 * appears in a client key (SPEC 1.3). Notification preferences are a v1 stub: action-needed emails cannot be muted (D-09).
 */
export const ClientNotificationPrefDto = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  /** action-needed emails: always on, no toggle */
  required: z.boolean(),
  enabled: z.boolean(),
}).strict();
export type ClientNotificationPrefDto = z.infer<typeof ClientNotificationPrefDto>;

export const ClientAccountDto = z.object({
  name: z.string(),
  email: z.string(),
  role: z.enum(["client_owner", "client_member"]),
  passwordSetAt: isoDateTime.nullable(),
  lastSeenAt: isoDateTime.nullable(),
  company: z.object({
    name: z.string(),
    country: z.string().nullable(),
    vatId: z.string().nullable(),
    language: z.string(),
    currencyDisplay: z.string(),
    defaultIncoterm: z.string(),
    timezone: z.string(),
    /** how prices are shown on offers and orders */
    pricingDisplay: z.enum(["all_in", "factory_plus_fee"]),
  }).strict(),
  teammates: z.array(z.object({ name: z.string(), email: z.string(), status: z.enum(["invited", "active"]) }).strict()),
  notifications: z.array(ClientNotificationPrefDto),
}).strict();
export type ClientAccountDto = z.infer<typeof ClientAccountDto>;

/* ────────── form inputs (browser-safe: imported by the client components as well as the repository) ────────── */

export const ProfileInput = z.object({ name: z.string().trim().min(2, "At least 2 characters").max(80, "At most 80 characters") }).strict();
export type ProfileInput = z.input<typeof ProfileInput>;

/** SPEC F-01: ≥ 10 chars, ≥ 1 letter, ≥ 1 digit; confirm equals. Checked client-side before Better Auth `changePassword`. */
export const PasswordInput = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(10, "At least 10 characters").regex(/[A-Za-z]/, "Include at least one letter").regex(/\d/, "Include at least one digit"),
    confirm: z.string(),
  })
  .strict()
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "Passwords do not match" });
export type PasswordInput = z.input<typeof PasswordInput>;
