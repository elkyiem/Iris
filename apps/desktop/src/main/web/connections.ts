import type { z } from "zod";
import type {
  BrowserConnectionsRequestSchema,
  PairBrowserSchema,
} from "../../shared/web-connections-contracts";
import { libraryAccess } from "../core/library-access";
import type { createWebSessions } from "./auth";
import { createBrowserPairing } from "./pairing";

type Request = z.infer<typeof BrowserConnectionsRequestSchema>;
type Sessions = ReturnType<typeof createWebSessions>;

export function createWebConnections(options: {
  sessions: Sessions;
  origin: string;
  libraryId(): string;
  now?: () => number;
}) {
  const { sessions } = options;
  const pairing = createBrowserPairing(options.now);
  let closed = false;
  const nativeScope = () => `${options.origin}\0${options.libraryId()}`;
  function scopeOrigin(scope: string) {
    const origin = scope.split("\0")[0];
    if (!origin) throw new Error("Missing connection origin.");
    return origin;
  }
  function assertOpen() {
    if (closed || sessions.isClosed() || !libraryAccess.isOpen())
      throw new Error("Circé is reopening. Try again shortly.");
  }
  function list(scope: string, cookie?: string) {
    assertOpen();
    return {
      available: true,
      origin: scopeOrigin(scope),
      currentId: sessions.deviceId(cookie),
      devices: sessions.list(scope),
    };
  }
  async function revoke(scope: string, id: string) {
    assertOpen();
    if (sessions.revokeDevice(id, scope)) pairing.revokeIssuer(id);
    await sessions.flush();
    return { ok: true };
  }
  function create(scope: string, issuer: string) {
    assertOpen();
    return pairing.create(scope, issuer, scopeOrigin(scope));
  }
  return {
    nativeList: () => list(nativeScope()),
    nativeCreateCode: () => create(nativeScope(), "native"),
    nativeCancelCode: (id: string) => {
      assertOpen();
      return { ok: pairing.cancel(nativeScope(), "native", id) };
    },
    nativeRevoke: (id: string) => revoke(nativeScope(), id),
    async manage(input: Request, scope: string, cookie: string | undefined) {
      assertOpen();
      if (
        !sessions.valid(cookie, scope) ||
        !scope.endsWith(`\0${options.libraryId()}`)
      )
        throw new Error(
          "This browser is no longer connected. Reload to reconnect.",
        );
      const issuer = sessions.deviceId(cookie);
      if (!issuer) throw new Error("This browser is no longer connected.");
      switch (input.action) {
        case "list":
          return list(scope, cookie);
        case "create":
          return create(scope, issuer);
        case "cancel":
          return { ok: pairing.cancel(scope, issuer, input.id) };
        case "revoke":
          return revoke(scope, input.id);
      }
    },
    async redeem(scope: string, input: z.infer<typeof PairBrowserSchema>) {
      assertOpen();
      const issuer = pairing.redeem(scope, input.code);
      if (
        !issuer ||
        (issuer !== "native" &&
          !sessions.list(scope).some((device) => device.id === issuer))
      )
        return null;
      const id = sessions.issue(scope, input);
      try {
        await sessions.flush();
        if (
          !sessions.valid(id, scope) ||
          (issuer !== "native" &&
            !sessions.list(scope).some((device) => device.id === issuer)) ||
          !scope.endsWith(`\0${options.libraryId()}`)
        ) {
          sessions.revoke(id);
          await sessions.flush();
          return null;
        }
        return id;
      } catch (error) {
        sessions.revoke(id);
        throw error;
      }
    },
    revokeCookie(cookie: string | undefined) {
      const issuer = sessions.deviceId(cookie);
      if (issuer) pairing.revokeIssuer(issuer);
    },
    close: () => {
      closed = true;
      pairing.close();
    },
  };
}

let active: ReturnType<typeof createWebConnections> | null = null;

export function registerWebConnections(
  connections: ReturnType<typeof createWebConnections>,
) {
  if (active) throw new Error("Browser connections already have an owner.");
  active = connections;
  return () => {
    if (active === connections) active = null;
    connections.close();
  };
}

export function webConnections() {
  return active;
}
