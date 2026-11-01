import type { BrowserConnectionInput } from "@shared/web-connections-contracts";
import { WebSessionSchema } from "@shared/web-contracts";
import { webRequest } from "./adapter";

export async function connectBrowser(input: BrowserConnectionInput) {
  const options = { remember: input.remember, label: input.label };
  const route = input.method === "key" ? "session" : "pair";
  const body =
    input.method === "key"
      ? { key: input.key, ...options }
      : { code: input.code, ...options };
  return WebSessionSchema.parse(await webRequest(route, JSON.stringify(body)));
}

/** Only an authentication rejection should open the access-key form. */
export async function readBrowserSession() {
  const response = await fetch("/web/session");
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("The host is temporarily unavailable.");
  return WebSessionSchema.parse(await response.json());
}
