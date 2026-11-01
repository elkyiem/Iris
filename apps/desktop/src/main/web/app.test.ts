import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import {
  BrowserConnectionsSchema,
  PairingCodeSchema,
} from "../../shared/web-connections-contracts";
import type { WireSyncAction } from "../../shared/wire";
import { libraryAccess } from "../core/library-access";
import { createKeychain } from "../keychain";
import { createWebApp, type WebHost } from "./app";
import { createWebSessions } from "./auth";

const cleanups: Array<() => Promise<void>> = [];

async function connectionRequest(
  test: Awaited<ReturnType<typeof host>>,
  cookie: string,
  input:
    | { action: "list" | "create" }
    | { action: "cancel" | "revoke"; id: string },
) {
  return test.request("/web/connections", {
    method: "POST",
    headers: {
      cookie,
      origin: test.config.origin,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

describe("browser pairing HTTP", () => {
  it("pairs a remembered browser, lets it connect a second browser, and durably disconnects it", async () => {
    const test = await host();
    const owner = await test.login();
    const created = await connectionRequest(test, owner, { action: "create" });
    expect(created.status).toBe(200);
    const code = PairingCodeSchema.parse(await created.json());
    const pair = await test.request("/web/pair", {
      method: "POST",
      headers: {
        origin: test.config.origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        code: code.code,
        remember: true,
        label: "Windows browser",
      }),
    });
    expect(pair.status).toBe(200);
    expect(pair.headers.get("set-cookie")).toContain("Max-Age=7776000");
    expect(pair.headers.get("set-cookie")).toContain("HttpOnly");
    const cookie = pair.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Missing paired cookie");
    const listing = BrowserConnectionsSchema.parse(
      await (await connectionRequest(test, cookie, { action: "list" })).json(),
    );
    expect(listing.devices).toHaveLength(2);
    expect(
      listing.devices.find((row) => row.id === listing.currentId),
    ).toMatchObject({ label: "Windows browser", remembered: true });
    expect(JSON.stringify(listing)).not.toContain(cookie.split("=")[1]);
    const next = await connectionRequest(test, cookie, { action: "create" });
    expect(next.status).toBe(200);
    const childCode = PairingCodeSchema.parse(await next.json());
    if (!listing.currentId) throw new Error("Missing device identity");
    expect(
      (
        await connectionRequest(test, owner, {
          action: "revoke",
          id: listing.currentId,
        })
      ).status,
    ).toBe(200);
    expect(
      (await test.request("/web/session", { headers: { cookie } })).status,
    ).toBe(401);
    const denied = await test.request("/web/pair", {
      method: "POST",
      headers: {
        origin: test.config.origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ code: childCode.code }),
    });
    expect(denied.status).toBe(401);
  });

  it("accepts only one simultaneous redemption and preserves the default twelve-hour cookie", async () => {
    const test = await host();
    const owner = await test.login();
    const code = PairingCodeSchema.parse(
      await (await connectionRequest(test, owner, { action: "create" })).json(),
    );
    const redeem = () =>
      test.request("/web/pair", {
        method: "POST",
        headers: {
          origin: test.config.origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ code: code.code }),
      });
    const replies = await Promise.all([redeem(), redeem()]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 401]);
    expect(
      replies.find((reply) => reply.status === 200)?.headers.get("set-cookie"),
    ).toContain("Max-Age=43200");
  });

  it("keeps management out of guest, cross-origin and generic-query access", async () => {
    const test = await host();
    expect(
      (await connectionRequest(test, "", { action: "create" })).status,
    ).toBe(401);
    const owner = await test.login();
    expect(
      (
        await test.request("/web/connections", {
          method: "POST",
          headers: {
            cookie: owner,
            origin: "https://other.test",
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: "create" }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await test.request("/web/query", {
          method: "POST",
          headers: {
            cookie: owner,
            origin: test.config.origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "webConnections.createCode",
            params: {},
          }),
        })
      ).status,
    ).toBe(422);
    expect(test.calls).not.toContain("webConnections.createCode");
    const code = PairingCodeSchema.parse(
      await (await connectionRequest(test, owner, { action: "create" })).json(),
    );
    expect(
      (
        await test.request("/web/pair", {
          method: "POST",
          headers: {
            origin: "https://other.test",
            "content-type": "application/json",
          },
          body: JSON.stringify({ code: code.code }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await test.request("/web/pair", {
          method: "POST",
          headers: {
            origin: test.config.origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({ code: code.code }),
        })
      ).status,
    ).toBe(200);
  });

  it("exhausts a code globally despite forwarded-address changes and invalidates it on logout", async () => {
    const test = await host();
    const owner = await test.login();
    const code = PairingCodeSchema.parse(
      await (await connectionRequest(test, owner, { action: "create" })).json(),
    );
    const wrong = code.code === "000000" ? "000001" : "000000";
    for (const ip of ["1", "2", "3", "4", "5"]) {
      const reply = await test.request("/web/pair", {
        method: "POST",
        headers: {
          origin: test.config.origin,
          "content-type": "application/json",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({ code: wrong }),
      });
      expect(reply.status).toBe(401);
    }
    const redeem = (value: string) =>
      test.request("/web/pair", {
        method: "POST",
        headers: {
          origin: test.config.origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ code: value }),
      });
    expect((await redeem(code.code)).status).toBe(401);
    const next = PairingCodeSchema.parse(
      await (await connectionRequest(test, owner, { action: "create" })).json(),
    );
    expect(
      (
        await test.request("/web/session", {
          method: "DELETE",
          headers: { origin: test.config.origin, cookie: owner },
        })
      ).status,
    ).toBe(200);
    expect((await redeem(next.code)).status).toBe(401);
  });
});
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

it.each(["media", "preview", "download"])(
  "retains the %s HTTP body lease until a slow reader disconnects",
  async (kind) => {
    const test = await host();
    const cookie = await test.login();
    const cancelled = Promise.withResolvers<void>();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("first"));
      },
      cancel() {
        cancelled.resolve();
      },
    });
    const response = async () => new Response(stream);
    test.config.media = response;
    test.config.preview = response;
    test.config.download = response;
    const reply = await test.request(
      kind === "download"
        ? "/web/download/owned"
        : `/web/${kind}/owned/file.txt`,
      { headers: { cookie } },
    );
    expect(reply.status).toBe(200);
    const reader = reply.body?.getReader();
    if (!reader) throw new Error("Missing streamed response.");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
    let changed = false;
    const transition = libraryAccess.transition({
      prepare: async () => {},
      operation: async () => {
        changed = true;
      },
      keepClosed: () => false,
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(changed).toBe(false);
      await reader.cancel();
      await cancelled.promise;
      await transition;
      expect(changed).toBe(true);
    } finally {
      await reader.cancel();
      await transition;
    }
  },
);

async function host(assets = "/nonexistent", overrides: Partial<WebHost> = {}) {
  const listeners = new Set<(event: WireSyncAction) => void>();
  const calls: string[] = [];
  const config: WebHost = {
    origin: "",
    key: "test-only-access-key",
    assets,
    libraryId: () => "test-library",
    query: async ({ name }) => {
      calls.push(name);
      return Response.json({ ok: true });
    },
    media: async () => new Response("private media"),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...overrides,
  };
  const app = createWebApp(config);
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  /** SAFETY: a listening TCP server has an AddressInfo address. */
  const address = server.address() as AddressInfo;
  config.origin = `http://127.0.0.1:${address.port}`;
  cleanups.push(
    () =>
      new Promise((resolve) => {
        if (server instanceof Server) server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${config.origin}${path}`, {
      ...init,
      headers: { "x-iris-library": config.libraryId(), ...init.headers },
    });
  const login = async () => {
    const response = await request("/web/session", {
      method: "POST",
      headers: { origin: config.origin, "content-type": "application/json" },
      body: JSON.stringify({ key: config.key }),
    });
    return response.headers.get("set-cookie")?.split(";")[0] ?? "";
  };
  return { app, config, request, login, calls, listeners };
}

describe("browser host boundary", () => {
  it("keeps the authenticated event stream through a temporary Library operation and delivers its mutations", async () => {
    const test = await host();
    const statuses = new Set<(event: { name: string; data: string }) => void>();
    test.config.subscribeStatus = (listener) => {
      statuses.add(listener);
      return () => {
        statuses.delete(listener);
      };
    };
    test.config.libraryId = () => {
      libraryAccess.assertDatabaseAvailable();
      return "test-library";
    };
    const cookie = await test.login();
    const controller = new AbortController();
    const response = await test.request("/web/events", {
      headers: { cookie },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]),
    });
    const reader = response.body?.getReader();
    await reader?.read();
    try {
      await libraryAccess.transition({
        prepare: async () => {
          for (const listener of statuses)
            listener({ name: "enrichment", data: "paused-fixture" });
        },
        operation: async () => {
          libraryAccess.sealDatabase();
          const action: WireSyncAction = {
            id: 7,
            batchId: null,
            modelName: "save",
            modelId: "merged-fixture",
            action: "U",
            data: { status: "complete" },
            prevData: null,
            actor: "system",
            actorReason: "merge",
            createdAt: 1234,
          };
          for (const listener of test.listeners) listener(action);
          expect(statuses.size).toBe(1);
          expect(test.listeners.size).toBe(1);
        },
        keepClosed: () => false,
      });
      for (const listener of statuses)
        listener({ name: "enrichment", data: "resumed-fixture" });
      let delivered = "";
      while (!delivered.includes("resumed-fixture")) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        delivered += new TextDecoder().decode(chunk.value);
      }
      expect(delivered).toContain("paused-fixture");
      expect(delivered).toContain('"modelId":"merged-fixture"');
      expect(delivered).toContain("resumed-fixture");
      expect(delivered.match(/event: sync/g)).toHaveLength(1);
      expect(statuses.size).toBe(1);
    } finally {
      controller.abort();
      await reader?.cancel().catch(() => {});
    }
  });
  it("authenticates and fences Library copies before passing a scoped destination", async () => {
    const test = await host();
    const copies: string[] = [];
    test.config.copyLibrary = async (input, library, session) => {
      copies.push(`${library}:${input.ids.join(",")}`);
      expect(session.length).toBeGreaterThan(20);
      return Response.json({ ok: true });
    };
    const cookie = await test.login();
    const send = (
      destination: string,
      library = "test-library",
      credential = cookie,
      origin = test.config.origin,
    ) =>
      test.request("/web/copy-library", {
        method: "POST",
        headers: {
          cookie: credential,
          origin,
          "x-iris-library": library,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ids: ["save-a"], destination }),
      });
    const grant = "5db30cb2-dbbb-40f2-9daa-8718b41bba56";
    expect((await send(grant, "test-library", "")).status).toBe(401);
    expect(
      (await send(grant, "test-library", cookie, "https://other.test")).status,
    ).toBe(403);
    expect((await send(grant, "stale")).status).toBe(409);
    expect((await send("/Users/private/Other.pond")).status).toBe(422);
    expect(copies).toEqual([]);
    expect((await send(grant)).status).toBe(200);
    expect(copies).toEqual(["test-library:save-a"]);
  });
  it("permits only the browser preview page to be framed by its own origin", async () => {
    const test = await host();
    const preview = await test.request("/browser-preview.html");
    expect(preview.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(preview.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'self'",
    );
    for (const path of ["/", "/browser.html", "/web/ready"])
      expect((await test.request(path)).headers.get("x-frame-options")).toBe(
        "DENY",
      );
  });

  it("sends a current history snapshot when subscribing after background work", async () => {
    const test = await host();
    test.config.history = async () => ({
      revision: 12,
      canUndo: true,
      canRedo: false,
    });
    const cookie = await test.login();
    const controller = new AbortController();
    const response = await test.request("/web/events", {
      headers: { cookie },
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing host events");
    try {
      let content = "";
      for (
        let count = 0;
        count < 4 && !content.includes('"revision":12');
        count++
      ) {
        const next = await reader.read();
        if (next.done) break;
        content += new TextDecoder().decode(next.value);
      }
      expect(content).toContain("event: history");
      expect(content).toContain('"revision":12');
      expect(content).toContain('"canUndo":true');
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });
  it("never authorizes a watched folder from a forged path or another Library", async () => {
    const test = await host();
    const controls: string[] = [];
    test.config.watchedFolder = async (input, library) => {
      controls.push(library);
      return Response.json({ ok: true, name: input.name });
    };
    const cookie = await test.login();
    const send = (
      params: Record<string, string | boolean>,
      library = "test-library",
    ) =>
      test.request("/web/watched-folder", {
        method: "POST",
        headers: {
          cookie,
          origin: test.config.origin,
          "content-type": "application/json",
          "x-iris-library": library,
        },
        body: JSON.stringify({ name: "autoImport.set", params }),
      });
    expect((await send({ enabled: true, path: "/Users/private" })).status).toBe(
      422,
    );
    expect((await send({ enabled: true }, "old-library")).status).toBe(409);
    expect(controls).toEqual([]);
    expect((await send({ enabled: false, path: "" })).status).toBe(200);
    expect(controls).toEqual(["test-library"]);
  });
  it("cannot bypass a host folder selection through ordinary preferences", async () => {
    const test = await host();
    const cookie = await test.login();
    for (const autoImport of [
      { path: "/Users/private", enabled: true },
      { enabled: true },
    ]) {
      const response = await test.request("/web/query", {
        method: "POST",
        headers: {
          cookie,
          origin: test.config.origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "settings.setPrefs",
          params: { autoImport },
        }),
      });
      expect(response.status).toBe(422);
    }
    expect(test.calls).toEqual([]);
  });
  it("binds host folder selections to the authenticated session and Library", async () => {
    const test = await host();
    const selections: Array<{ library: string; session: string }> = [];
    test.config.locations = async (_input, library, session) => {
      selections.push({ library, session });
      return Response.json({ entries: [] });
    };
    const cookie = await test.login();
    const browse = (
      headers: Record<string, string>,
      body = '{"action":"list","purpose":"parent"}',
    ) =>
      test.request("/web/locations", {
        method: "POST",
        headers: {
          origin: test.config.origin,
          "content-type": "application/json",
          ...headers,
        },
        body,
      });
    expect((await browse({})).status).toBe(401);
    expect(
      (await browse({ cookie, "x-iris-library": "old-library" })).status,
    ).toBe(409);
    expect(
      (await browse({ cookie, origin: "https://foreign.invalid" })).status,
    ).toBe(403);
    expect(
      (
        await browse(
          { cookie },
          '{"action":"list","purpose":"parent","path":"/Users"}',
        )
      ).status,
    ).toBe(422);
    expect(selections).toEqual([]);
    expect((await browse({ cookie })).status).toBe(200);
    expect(selections).toEqual([
      {
        library: "test-library",
        session: cookie.slice(cookie.indexOf("=") + 1),
      },
    ]);
  });

  it("rejects incomplete or raw-path Library operations before native dialog fallback", async () => {
    const test = await host();
    let invoked = 0;
    test.config.library = async () => {
      invoked += 1;
      return Response.json({ ok: true });
    };
    const cookie = await test.login();
    for (const operation of [
      { name: "library.move", params: {} },
      { name: "library.backupTo", params: { path: "/tmp/backup.pond" } },
      {
        name: "library.restoreBackup",
        params: { source: crypto.randomUUID() },
      },
      { name: "library.switchTo", params: { source: "/Users/example.pond" } },
      {
        name: "library.createAt",
        params: { parent: crypto.randomUUID(), name: "../escape" },
      },
    ]) {
      const response = await test.request("/web/library", {
        method: "POST",
        headers: {
          cookie,
          origin: test.config.origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(operation),
      });
      expect(response.status).toBe(422);
    }
    expect(invoked).toBe(0);
  });

  it("keeps a dormant stream without reading sealed Library paths during prepared shutdown", async () => {
    const test = await host();
    const status = new Set<(event: { name: string; data: string }) => void>();
    test.config.subscribeStatus = (listener) => {
      status.add(listener);
      return () => status.delete(listener);
    };
    test.config.libraryId = () => {
      libraryAccess.assertDatabaseAvailable();
      return "test-library";
    };
    const cookie = await test.login();
    const controller = new AbortController();
    const response = await test.request("/web/events", {
      headers: { cookie },
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    await reader?.read();
    expect(status.size).toBe(1);
    await libraryAccess.transition({
      prepare: async () => {},
      operation: async () => libraryAccess.sealDatabase(),
      keepClosed: () => true,
    });
    try {
      expect(() => {
        for (const listener of status)
          listener({ name: "enrichment", data: "{}" });
      }).not.toThrow();
      expect(status.size).toBe(1);
      const reconnect = await fetch(`${test.config.origin}/web/events`, {
        headers: { cookie, "x-iris-library": "test-library" },
      });
      expect(reconnect.status).toBe(503);
      expect((await fetch(`${test.config.origin}/web/ready`)).status).toBe(200);
    } finally {
      controller.abort();
      await reader?.cancel().catch(() => {});
      await libraryAccess.transition({
        prepare: async () => {},
        operation: async () => {},
        keepClosed: () => false,
      });
    }
  });
  it("drains an admitted HTTP read and rejects new queries while keeping process liveness available", async () => {
    const test = await host();
    const release = Promise.withResolvers<void>();
    const began = Promise.withResolvers<void>();
    const renamed = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    test.config.query = async () => {
      began.resolve();
      await release.promise;
      return Response.json({ ok: true });
    };
    const cookie = await test.login();
    const request = () =>
      test.request("/web/query", {
        method: "POST",
        headers: {
          cookie,
          origin: test.config.origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "library.info", params: {} }),
      });
    const reading = request();
    await began.promise;
    const transition = libraryAccess.transition({
      prepare: async () => {},
      operation: async () => {
        libraryAccess.sealDatabase();
        renamed.resolve();
        await finish.promise;
      },
      keepClosed: () => false,
    });
    try {
      expect((await request()).status).toBe(503);
      expect((await test.request("/web/ready")).status).toBe(200);
      release.resolve();
      expect((await reading).status).toBe(200);
      await renamed.promise;
      expect((await request()).status).toBe(503);
      expect((await test.request("/web/ready")).status).toBe(200);
    } finally {
      release.resolve();
      finish.resolve();
      await transition;
    }
    expect((await request()).status).toBe(200);
  });
  it("exposes only process liveness before login and changes the identity for a new host", async () => {
    const first = await host();
    const second = await host();
    const ready = await first.request("/web/ready");
    expect(ready.status).toBe(200);
    const identity = await ready.json();
    expect(Object.keys(identity)).toEqual(["instance"]);
    expect(identity.instance).not.toBe(
      (await (await second.request("/web/ready")).json()).instance,
    );
    expect(
      (
        await first.request("/web/ready", {
          headers: { origin: "https://attacker.test" },
        })
      ).status,
    ).toBe(403);
  });
  it("admits Library transitions only for an authenticated exact-origin current Library", async () => {
    const test = await host();
    const calls: string[] = [];
    test.config.library = async (input, library) => {
      if (input.name !== "library.rename")
        throw new Error("Unexpected transition");
      calls.push(`${library}:${input.params.name}`);
      return Response.json({ ok: true, restarting: true });
    };
    const body = JSON.stringify({
      name: "library.rename",
      params: { name: "Twitter" },
    });
    expect(
      (await test.request("/web/library", { method: "POST", body })).status,
    ).toBe(401);
    const cookie = await test.login();
    for (const [origin, library, status] of [
      ["https://attacker.test", "test-library", 403],
      [test.config.origin, "other-library", 409],
      [test.config.origin, "test-library", 200],
    ] as const) {
      const response = await test.request("/web/library", {
        method: "POST",
        body,
        headers: {
          cookie,
          origin,
          "x-iris-library": library,
          "content-type": "application/json",
        },
      });
      expect(response.status).toBe(status);
    }
    expect(calls).toEqual(["test-library:Twitter"]);
    for (const params of [
      { name: "Twitter", path: "/private/library" },
      { name: "" },
    ]) {
      expect(
        (
          await test.request("/web/library", {
            method: "POST",
            body: JSON.stringify({ name: "library.rename", params }),
            headers: {
              cookie,
              origin: test.config.origin,
              "content-type": "application/json",
            },
          })
        ).status,
      ).toBe(422);
    }
  });
  it("requires the current authenticated Library and exact origin for logo operations", async () => {
    const test = await host();
    const seen: string[] = [];
    test.config.files = async (input, library) => {
      seen.push(`${library}:${input.name}`);
      return Response.json({
        ok: true,
        icon: "data:image/png;base64,aWNvbg==",
      });
    };
    const body = JSON.stringify({
      name: "library.identity.pickIcon",
      params: { paths: ["iris-upload:11111111-1111-4111-8111-111111111111"] },
    });
    expect(
      (await test.request("/web/files", { method: "POST", body })).status,
    ).toBe(401);
    const cookie = await test.login();
    for (const [origin, library, status] of [
      ["https://attacker.test", "test-library", 403],
      [test.config.origin, "other-library", 409],
      [test.config.origin, "test-library", 200],
    ] as const) {
      const response = await test.request("/web/files", {
        method: "POST",
        body,
        headers: {
          cookie,
          origin,
          "x-iris-library": library,
          "content-type": "application/json",
        },
      });
      expect(response.status).toBe(status);
    }
    expect(seen).toEqual(["test-library:library.identity.pickIcon"]);
  });
  it("serves the application document for deep links and preserves missing API/asset errors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "iris-web-routes-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    await writeFile(
      join(directory, "browser.html"),
      "<!doctype html><title>Circé route fixture</title>",
    );
    const test = await host(directory);
    for (const path of [
      "/",
      "/assistant",
      "/save/fixture",
      "/settings/agent-models",
    ])
      expect(await (await test.request(path)).text()).toBe(
        "<!doctype html><title>Circé route fixture</title>",
      );
    expect((await test.request("/assets/missing.js")).status).toBe(404);
    expect((await test.request("/web/missing")).status).toBe(401);
    expect(
      (
        await test.request("/web/missing", {
          headers: { cookie: await test.login() },
        })
      ).status,
    ).toBe(404);
  });
  it("caches only fingerprinted application assets and applies final security headers to direct responses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "circe-web-cache-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    await mkdir(join(directory, "assets"));
    await writeFile(
      join(directory, "browser.html"),
      "<!doctype html><title>App</title>",
    );
    await writeFile(
      join(directory, "assets/app-Abcd1234.js"),
      "/* public compiled UI */",
    );
    await writeFile(join(directory, "assets/state-Abcd1234.json"), "{}");
    const test = await host(directory);
    const asset = await test.request("/assets/app-Abcd1234.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const cookie = await test.login();
    for (const path of [
      "/",
      "/assets/state-Abcd1234.json",
      "/assets/missing-Abcd1234.js",
      "/web/session",
      "/web/media/save/image.png",
    ]) {
      const response = await test.request(path, { headers: { cookie } });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      await response.body?.cancel();
    }
    await asset.body?.cancel();
  });
  it("requires authentication for queries, media and events", async () => {
    const test = await host();
    for (const path of [
      "/web/session",
      "/web/events",
      "/web/media/save/photo.png",
      "/web/download/00000000-0000-0000-0000-000000000000",
      "/web/preview/save/missing.mp4",
    ])
      expect((await test.request(path)).status).toBe(401);
    for (const path of [
      "query",
      "files",
      "video",
      "agent",
      "command",
      "transactions",
      "history",
    ])
      expect(
        (await test.request(`/web/${path}`, { method: "POST" })).status,
      ).toBe(401);
    expect((await test.request("/web/upload", { method: "PUT" })).status).toBe(
      401,
    );
  });
  it("sets an HttpOnly strict session and rejects bad credentials", async () => {
    const test = await host();
    const response = await test.request("/web/session", {
      method: "POST",
      headers: {
        origin: test.config.origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ key: "wrong" }),
    });
    expect(response.status).toBe(401);
    const cookie = await test.login();
    expect(cookie).toMatch(/^iris_session=/);
    expect(
      (await test.request("/web/session", { headers: { cookie } })).status,
    ).toBe(200);
  });
  it("rejects foreign origins, missing mutation origins and DNS rebinding", async () => {
    const test = await host();
    const cookie = await test.login();
    for (const origin of ["https://attacker.test", "null", ""]) {
      const response = await test.request("/web/query", {
        method: "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        body: JSON.stringify({
          name: "folders.create",
          params: { name: "no" },
        }),
      });
      expect(response.status).toBe(403);
    }
    const response = await test.app.request("/web/session", {
      headers: { cookie, host: "attacker.test" },
    });
    expect(response.status).toBe(403);
    expect(test.calls).toEqual([]);
    expect(
      (
        await test.app.request("/web/media/save/image.png", {
          headers: {
            host: new URL(test.config.origin).host,
            cookie,
            "sec-fetch-site": "same-site",
          },
        })
      ).status,
    ).toBe(403);
  });
  it("allows only the explicit catalog and excludes Source/provider credentials and native paths", async () => {
    const test = await host();
    const cookie = await test.login();
    for (const name of [
      "settings.webAccessKey",
      "agent.readKey",
      "agent.mcpClients",
      "saves.createManual",
      "library.switchTo",
      "saves.filePath",
      "extension.safariStatus",
      "extension.openSafariSettings",
      "extension.openSafari",
      "__proto__",
    ]) {
      const response = await test.request("/web/query", {
        method: "POST",
        headers: {
          cookie,
          origin: test.config.origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name }),
      });
      expect(response.status).toBe(422);
    }
    expect(test.calls).toEqual([]);
  });
  it("protects the explicit host integration token controls with session, Origin and Library checks", async () => {
    const test = await host();
    const directory = await mkdtemp(join(tmpdir(), "circe-integration-token-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const keychain = createKeychain({
      platform: "linux",
      userDataPath: () => directory,
      encryptionAvailable: () => false,
      protect: (value) => Buffer.from(value),
      unprotect: (value) => value.toString(),
    });
    await keychain.ensureIngestToken();
    let reads = 0;
    test.config.query = async ({ name }) => {
      reads++;
      if (name === "settings.ingestToken")
        return Response.json({ token: await keychain.getIngestToken() });
      if (name === "settings.rotateIngestToken")
        return Response.json({ token: await keychain.rotateIngestToken() });
      throw new Error("Unexpected integration token operation.");
    };
    const cookie = await test.login();
    const query = (name: string, headers: Record<string, string>) =>
      test.request("/web/query", {
        method: "POST",
        headers,
        body: JSON.stringify({ name, params: {} }),
      });
    expect(
      (await query("settings.ingestToken", { origin: test.config.origin }))
        .status,
    ).toBe(401);
    expect(
      (
        await query("settings.ingestToken", {
          cookie,
          origin: "https://replay.attacker.test",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await query("settings.rotateIngestToken", {
          cookie,
          origin: test.config.origin,
          "x-iris-library": "stale-library",
        })
      ).status,
    ).toBe(409);
    expect(reads).toBe(0);
    const original = await query("settings.ingestToken", {
      cookie,
      origin: test.config.origin,
    });
    expect(original.status).toBe(200);
    expect(original.headers.get("cache-control")).toBe("no-store");
    const before = await original.json();
    const rotated = await query("settings.rotateIngestToken", {
      cookie,
      origin: test.config.origin,
    });
    expect(rotated.status).toBe(200);
    const after = await rotated.json();
    expect(after.token).not.toBe(before.token);
    expect(await keychain.getIngestToken()).toBe(after.token);
    expect(
      (await test.request("/web/session", { headers: { cookie } })).status,
    ).toBe(200);
  });
  it("serves media to a session and revokes access on logout", async () => {
    const test = await host();
    const cookie = await test.login();
    expect(
      await (
        await test.request("/web/media/save/image.png", { headers: { cookie } })
      ).text(),
    ).toBe("private media");
    await test.request("/web/session", {
      method: "DELETE",
      headers: { cookie, origin: test.config.origin },
    });
    expect(
      (await test.request("/web/media/save/image.png", { headers: { cookie } }))
        .status,
    ).toBe(401);
  });
  it("accepts only configured private origins and keeps their sessions separate", async () => {
    const test = await host();
    const remoteOrigin = "https://iris.owner.ts.net:9443";
    test.config.origins = [remoteOrigin];
    const response = await test.app.request(
      `${remoteOrigin}/web/session`,
      {
        method: "POST",
        headers: {
          host: "iris.owner.ts.net:9443",
          origin: remoteOrigin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ key: test.config.key }),
      },
      { incoming: { socket: { remoteAddress: "127.0.0.1" } } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Secure");
    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(
      (
        await test.app.request(`${remoteOrigin}/web/session`, {
          headers: { host: "iris.owner.ts.net:9443", cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (await test.request("/web/session", { headers: { cookie } })).status,
    ).toBe(401);
    expect(
      (
        await test.app.request("/web/session", {
          method: "POST",
          headers: {
            host: "iris.owner.ts.net:9443",
            origin: test.config.origin,
          },
        })
      ).status,
    ).toBe(403);
  });
  it("revokes an idle event stream immediately on logout", async () => {
    const test = await host();
    const cookie = await test.login();
    const controller = new AbortController();
    const stream = await test.request("/web/events", {
      headers: { cookie },
      signal: controller.signal,
    });
    const reader = stream.body?.getReader();
    await reader?.read();
    expect(test.listeners.size).toBe(1);
    await test.request("/web/session", {
      method: "DELETE",
      headers: { cookie, origin: test.config.origin },
    });
    expect(test.listeners.size).toBe(0);
    controller.abort();
    await reader?.cancel().catch(() => {});
  });
  it("rejects writes for a stale Library before invoking a handler", async () => {
    const test = await host();
    const cookie = await test.login();
    const response = await test.request("/web/query", {
      method: "POST",
      headers: {
        cookie,
        origin: test.config.origin,
        "content-type": "application/json",
        "x-iris-library": "another-library",
      },
      body: JSON.stringify({
        name: "folders.create",
        params: { name: "wrong target" },
      }),
    });
    expect(response.status).toBe(409);
    expect(test.calls).toEqual([]);
  });
  it.each(["pipeline:finalize", "pipeline:refresh-blocked"])(
    "delivers %s over an authenticated event stream and cleans up on disconnect",
    async (actorReason) => {
      const test = await host();
      const cookie = await test.login();
      const controller = new AbortController();
      const response = await test.request("/web/events", {
        headers: { cookie },
        signal: controller.signal,
      });
      const reader = response.body?.getReader();
      const first = await reader?.read();
      expect(new TextDecoder().decode(first?.value)).toContain("event: ready");
      expect(test.listeners.size).toBe(1);
      const action: WireSyncAction = {
        id: 7,
        batchId: null,
        modelName: "save",
        modelId: "fixture",
        action: "U",
        data: { status: "complete" },
        prevData: null,
        actor: "system",
        actorReason,
        createdAt: 1234,
      };
      for (const listener of test.listeners) listener(action);
      let delivered = "";
      while (!delivered.includes("event: sync")) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        delivered += new TextDecoder().decode(chunk.value);
      }
      expect(delivered).toContain('"status":"complete"');
      expect(delivered).toContain('"createdAt":1234');
      expect(delivered).toContain(JSON.stringify(actorReason));
      controller.abort();
      await reader?.cancel().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(test.listeners.size).toBe(0);
    },
  );
});

it("acknowledges login and logout only after their durable session writes finish", async () => {
  let start = Promise.withResolvers<void>();
  let release = Promise.withResolvers<void>();
  const sessions = createWebSessions("test-only-access-key", Date.now, {
    restored: [],
    warn: () => {},
    persist: async () => {
      start.resolve();
      await release.promise;
    },
  });
  const test = await host("/nonexistent", { sessions });
  let acknowledged = false;
  const login = test.login().then((cookie) => {
    acknowledged = true;
    return cookie;
  });
  await start.promise;
  expect(acknowledged).toBe(false);
  release.resolve();
  const cookie = await login;
  expect(cookie).toMatch(/^iris_session=/);
  start = Promise.withResolvers<void>();
  release = Promise.withResolvers<void>();
  acknowledged = false;
  const logout = test
    .request("/web/session", {
      method: "DELETE",
      headers: { origin: test.config.origin, cookie },
    })
    .then((response) => {
      acknowledged = true;
      return response;
    });
  await start.promise;
  expect(acknowledged).toBe(false);
  release.resolve();
  expect((await logout).status).toBe(200);
  expect(
    (await test.request("/web/session", { headers: { cookie } })).status,
  ).toBe(401);
  await sessions.close();
  expect(
    (
      await test.request("/web/session", {
        method: "DELETE",
        headers: { origin: test.config.origin, cookie },
      })
    ).status,
  ).toBe(503);
});

it("serves public app assets during a Library transition while private requests stay closed", async () => {
  const assets = await mkdtemp(join(tmpdir(), "circe-static-transition-"));
  cleanups.push(() => rm(assets, { recursive: true, force: true }));
  await mkdir(join(assets, "assets"));
  await writeFile(
    join(assets, "assets", "menu-12345678.css"),
    "body { color: red }",
  );
  await writeFile(
    join(assets, "browser.html"),
    "<html>Public app shell</html>",
  );
  const test = await host(assets);
  const cookie = await test.login();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const transition = libraryAccess.transition({
    prepare: async () => {},
    operation: async () => {
      entered.resolve();
      await release.promise;
    },
    keepClosed: () => false,
  });
  await entered.promise;
  try {
    const css = await test.request("/assets/menu-12345678.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(await css.text()).toBe("body { color: red }");
    expect(css.headers.get("cache-control")).toContain("immutable");
    const shell = await test.request("/");
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("Public app shell");
    expect(
      (await test.request("/web/session", { headers: { cookie } })).status,
    ).toBe(503);
  } finally {
    release.resolve();
    await transition;
  }
});
