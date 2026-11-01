import {
  BrowserConnectionsSchema,
  ConnectionIdSchema,
  PairingCodeSchema,
} from "@shared/web-connections-contracts";
import type { WebValue } from "@shared/web-serialization";
import { z } from "zod";

const names = new Map([
  ["webConnections.list", "list"],
  ["webConnections.createCode", "create"],
  ["webConnections.cancelCode", "cancel"],
  ["webConnections.revoke", "revoke"],
]);

export function createBrowserConnections(
  request: (path: string, body: string) => Promise<WebValue>,
) {
  return {
    handles: (name: string) => names.has(name),
    async query(name: string, params: WebValue) {
      const action = names.get(name);
      if (!action) throw new Error("Unknown connection action.");
      const input =
        action === "cancel" || action === "revoke"
          ? { action, ...ConnectionIdSchema.parse(params) }
          : { action };
      const reply = await request("connections", JSON.stringify(input));
      if (action === "list") return BrowserConnectionsSchema.parse(reply);
      if (action === "create") return PairingCodeSchema.parse(reply);
      return z.object({ ok: z.boolean() }).parse(reply);
    },
  };
}
