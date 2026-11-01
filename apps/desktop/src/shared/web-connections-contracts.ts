import { z } from "zod";

const BrowserLabelSchema = z.string().trim().min(1).max(80);
export const BrowserLoginOptionsSchema = z.object({
  remember: z.boolean().default(false),
  label: BrowserLabelSchema.default("Browser"),
});
export type BrowserLoginOptions = z.infer<typeof BrowserLoginOptionsSchema>;
export type BrowserConnectionInput = BrowserLoginOptions &
  ({ method: "code"; code: string } | { method: "key"; key: string });
const BrowserConnectionSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number(),
  expiresAt: z.number(),
  remembered: z.boolean(),
});
export const BrowserConnectionsSchema = z.object({
  available: z.boolean(),
  origin: z.string().nullable(),
  currentId: z.string().nullable(),
  devices: z.array(BrowserConnectionSchema),
});
export const PairingCodeSchema = z.object({
  id: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
  expiresAt: z.number(),
  origin: z.string(),
});
export const ConnectionIdSchema = z.strictObject({ id: z.string().uuid() });
export const BrowserConnectionsRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({ action: z.literal("create") }),
  ConnectionIdSchema.extend({ action: z.literal("cancel") }),
  ConnectionIdSchema.extend({ action: z.literal("revoke") }),
]);
export const PairBrowserSchema = BrowserLoginOptionsSchema.extend({
  code: z.string().regex(/^\d{6}$/),
});
export interface WebConnectionQueryInputs {
  "webConnections.list": Record<string, never>;
  "webConnections.createCode": Record<string, never>;
  "webConnections.cancelCode": z.infer<typeof ConnectionIdSchema>;
  "webConnections.revoke": z.infer<typeof ConnectionIdSchema>;
}
export interface WebConnectionQueryResults {
  "webConnections.list": z.infer<typeof BrowserConnectionsSchema>;
  "webConnections.createCode": z.infer<typeof PairingCodeSchema>;
  "webConnections.cancelCode": { ok: boolean };
  "webConnections.revoke": { ok: boolean };
}
