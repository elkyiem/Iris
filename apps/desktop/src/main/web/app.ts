import { randomUUID } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  type AgentStreamRequest,
  agentStreamRequest,
} from "../../shared/assistant";
import {
  type WebInference,
  WebInferenceSchema,
} from "../../shared/enrichment-contracts";
import { WEB_QUERY_ACCESS } from "../../shared/web-capabilities";
import {
  BrowserConnectionsRequestSchema,
  BrowserLoginOptionsSchema,
  PairBrowserSchema,
} from "../../shared/web-connections-contracts";
import {
  WebFixtureSchema,
  WebQueryRequestSchema,
} from "../../shared/web-contracts";
import {
  WebFileQuerySchema,
  WebUploadTokenSchema,
} from "../../shared/web-files-contracts";
import {
  type HostLocationsRequest,
  HostLocationsRequestSchema,
} from "../../shared/web-host-locations";
import { WebLibraryRequestSchema } from "../../shared/web-library-contracts";
import { WebLibraryCopySchema } from "../../shared/web-library-copy-contracts";
import {
  type WebHistorySchema,
  WebTransactionsSchema,
} from "../../shared/web-mutations";
import { WebReplayRequestSchema } from "../../shared/web-replay-contracts";
import { stringifyWebValue } from "../../shared/web-serialization";
import { WebVideoRequestSchema } from "../../shared/web-video-contracts";
import { WebWatchedFolderRequestSchema } from "../../shared/web-watched-folder-contracts";
import type { WireSyncAction } from "../../shared/wire";
import { LibraryTransitionError, libraryAccess } from "../core/library-access";
import {
  createWebSessions,
  REMEMBERED_BROWSER_SECONDS,
  WEB_SESSION_SECONDS,
} from "./auth";
import { createWebConnections } from "./connections";
import { WebRequestError } from "./errors";
import { createWebEventQueue } from "./event-queue";
import { createExtensionApi, type ExtensionHost } from "./extension-api";
import { libraryResponse } from "./library-response";
import { validateWebPreferences } from "./preferences";
import type { ReplayScope } from "./replay-host";

const COOKIE = "iris_session";
const Login = BrowserLoginOptionsSchema.extend({
  key: z.string().max(256),
}).strict();

export interface WebHost {
  connections?: ReturnType<typeof createWebConnections>;
  replay?: (
    input: ReturnType<typeof WebReplayRequestSchema.parse>,
    scope: ReplayScope,
    signal: AbortSignal,
  ) => Promise<Response>;
  copyLibrary?: (
    input: ReturnType<typeof WebLibraryCopySchema.parse>,
    libraryId: string,
    session: string,
  ) => Promise<Response>;
  watchedFolder?: (
    input: ReturnType<typeof WebWatchedFolderRequestSchema.parse>,
    libraryId: string,
    session: string,
  ) => Promise<Response>;
  locations?: (
    input: HostLocationsRequest,
    libraryId: string,
    session: string,
  ) => Promise<Response>;
  removeUpload?: (token: string, libraryId: string) => Promise<void>;
  inference?: (input: WebInference, libraryId: string) => Promise<Response>;
  library?: (
    input: ReturnType<typeof WebLibraryRequestSchema.parse>,
    libraryId: string,
    session: string,
  ) => Promise<Response>;
  extension?: ExtensionHost;
  origin: string;
  origins?: string[];
  key: string;
  sessions?: ReturnType<typeof createWebSessions>;
  assets: string;
  libraryId(): string;
  query(
    request: ReturnType<typeof WebQueryRequestSchema.parse>,
  ): Promise<Response>;
  media(request: Request, saveId: string, filename: string): Promise<Response>;
  subscribe(listener: (action: WireSyncAction) => void): () => void;
  subscribeStatus?: (
    listener: (event: { name: string; data: string }) => void,
  ) => () => void;
  history?: (action?: {
    kind: "undo" | "redo";
    revision: number;
  }) => Promise<ReturnType<typeof WebHistorySchema.parse> & { ok?: boolean }>;
  mutate?: (
    input: ReturnType<typeof WebTransactionsSchema.parse>,
    libraryId: string,
  ) => Promise<{ revision: number }>;
  command?: (
    input: Record<string, z.infer<ReturnType<typeof z.json>>>,
  ) => Promise<Response>;
  agent?: (input: AgentStreamRequest, signal: AbortSignal) => Promise<Response>;
  upload?: (
    request: Request,
    filename: string,
    libraryId: string,
  ) => Promise<Response>;
  files?: (
    input: ReturnType<typeof WebFileQuerySchema.parse>,
    libraryId: string,
  ) => Promise<Response>;
  download?: (
    request: Request,
    id: string,
    libraryId: string,
  ) => Promise<Response>;
  video?: (
    input: ReturnType<typeof WebVideoRequestSchema.parse>,
    libraryId: string,
  ) => Promise<Response>;
  preview?: (
    request: Request,
    saveId: string,
    filename: string,
  ) => Promise<Response>;
  fixture?: (
    kind: z.infer<typeof WebFixtureSchema>,
  ) => Promise<{ id: string; created: boolean }>;
  fixtureAsset?: (name: string) => Promise<Response>;
}

export function createWebApp(host: WebHost) {
  const app = new Hono<{
    Variables: { authenticatedScope: string; authenticatedLibrary: string };
  }>();
  const instance = randomUUID();
  app.use("*", async (c, next) => {
    await next();
    const fingerprinted =
      /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|svg|webp|avif)$/.test(
        c.req.path,
      );
    c.header(
      "Cache-Control",
      fingerprinted && c.res.ok
        ? "public, max-age=31536000, immutable"
        : "no-store",
    );
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "X-Frame-Options",
      c.req.path === "/browser-preview.html" ? "SAMEORIGIN" : "DENY",
    );
    if (c.req.path === "/browser-preview.html")
      c.header("Content-Security-Policy", "frame-ancestors 'self'");
  });
  app.use("*", async (c, next) => {
    if (
      (!c.req.path.startsWith("/web/") &&
        !c.req.path.startsWith("/extension")) ||
      ["/web/ready", "/web/events", "/web/library"].includes(c.req.path) ||
      (c.req.path === "/web/session" && c.req.method === "DELETE")
    ) {
      await next();
      return;
    }
    try {
      await libraryAccess.run(next);
    } catch (error) {
      if (error instanceof LibraryTransitionError)
        return c.json({ error: error.message }, 503);
      throw error;
    }
  });
  if (host.extension)
    app.route(
      "/extension",
      createExtensionApi(host.extension, () => [
        host.origin,
        ...(host.origins ?? []),
      ]),
    );
  const sessions = host.sessions ?? createWebSessions(host.key);
  const connections =
    host.connections ??
    createWebConnections({
      sessions,
      origin: host.origin,
      libraryId: host.libraryId,
    });
  const failures = new Map<string, { count: number; until: number }>();
  const requestOrigin = (hostHeader: string | undefined) =>
    [host.origin, ...(host.origins ?? [])].find(
      (origin) => new URL(origin).host === hostHeader,
    );
  const sessionScope = (hostHeader: string | undefined) =>
    `${requestOrigin(hostHeader)}\0${host.libraryId()}`;
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    const expectedOrigin = requestOrigin(c.req.header("host"));
    if (
      !expectedOrigin ||
      (c.req.path.startsWith("/web/") &&
        ((origin && origin !== expectedOrigin) ||
          ["cross-site", "same-site"].includes(
            c.req.header("sec-fetch-site") ?? "",
          )))
    ) {
      // Only disposable public fixture bytes have a host-only loopback path.
      if (
        host.fixtureAsset &&
        c.req.path.startsWith("/_fixtures/") &&
        getConnInfo(c).remote.address === "127.0.0.1" &&
        c.req.header("host")?.startsWith("127.0.0.1:")
      ) {
        return host.fixtureAsset(c.req.path.slice("/_fixtures/".length));
      }
      return c.json({ error: "This browser origin is not allowed." }, 403);
    }
    await next();
  });
  app.use("/web/session", bodyLimit({ maxSize: 1024 }));
  app.use("/web/pair", bodyLimit({ maxSize: 1024 }));
  app.post("/web/session", async (c) => {
    if (sessions.isClosed())
      return c.json(
        { error: "The host is restarting. Try again shortly." },
        503,
      );
    if (c.req.header("origin") !== requestOrigin(c.req.header("host")))
      return c.json({ error: "Origin required." }, 403);
    const ip = getConnInfo(c).remote.address ?? "local";
    const failure = failures.get(ip);
    if (failure && failure.until > Date.now() && failure.count >= 10)
      return c.json(
        { error: "Too many attempts. Try again in five minutes." },
        429,
      );
    const { key, ...options } = Login.parse(await c.req.json());
    const scope = sessionScope(c.req.header("host"));
    const id = sessions.login(key, scope, options);
    if (!id) {
      const entry =
        failure && failure.until > Date.now()
          ? failure
          : { count: 0, until: Date.now() + 300_000 };
      entry.count += 1;
      failures.set(ip, entry);
      return c.json({ error: "The access key was not accepted." }, 401);
    }
    await sessions.flush();
    if (!sessions.valid(id, scope))
      return c.json(
        { error: "The host is restarting. Try again shortly." },
        503,
      );
    failures.delete(ip);
    setCookie(c, COOKIE, id, {
      httpOnly: true,
      sameSite: "Strict",
      secure: c.req.header("origin")?.startsWith("https:"),
      path: "/",
      maxAge: options.remember
        ? REMEMBERED_BROWSER_SECONDS
        : WEB_SESSION_SECONDS,
    });
    return c.json({
      libraryId: host.libraryId(),
      fixtures: Boolean(host.fixture),
    });
  });
  app.post("/web/pair", async (c) => {
    if (sessions.isClosed())
      return c.json(
        { error: "The host is restarting. Try again shortly." },
        503,
      );
    if (c.req.header("origin") !== requestOrigin(c.req.header("host")))
      return c.json({ error: "Origin required." }, 403);
    const ip = getConnInfo(c).remote.address ?? "local";
    const failure = failures.get(ip);
    if (failure && failure.until > Date.now() && failure.count >= 10)
      return c.json(
        { error: "Too many attempts. Try again in five minutes." },
        429,
      );
    const input = PairBrowserSchema.parse(await c.req.json());
    const id = await connections.redeem(
      sessionScope(c.req.header("host")),
      input,
    );
    if (!id) {
      const entry =
        failure && failure.until > Date.now()
          ? failure
          : { count: 0, until: Date.now() + 300_000 };
      entry.count += 1;
      if (failures.size >= 200) {
        const oldest = failures.keys().next().value;
        if (oldest) failures.delete(oldest);
      }
      failures.set(ip, entry);
      return c.json(
        {
          error:
            "This code is incorrect or expired. Generate a new code on a connected device.",
        },
        401,
      );
    }
    failures.delete(ip);
    setCookie(c, COOKIE, id, {
      httpOnly: true,
      sameSite: "Strict",
      secure: c.req.header("origin")?.startsWith("https:"),
      path: "/",
      maxAge: input.remember ? REMEMBERED_BROWSER_SECONDS : WEB_SESSION_SECONDS,
    });
    return c.json({
      libraryId: host.libraryId(),
      fixtures: Boolean(host.fixture),
    });
  });
  // Liveness contains no Library information or credentials and obeys exact-origin checks.
  app.get("/web/ready", (c) => c.json({ instance }));
  // Revoking the presented cookie needs no Library paths, including during shutdown.
  app.delete("/web/session", async (c) => {
    if (sessions.isClosed())
      return c.json(
        { error: "The host is restarting. Try again shortly." },
        503,
      );
    if (c.req.header("origin") !== requestOrigin(c.req.header("host")))
      return c.json({ error: "Origin required." }, 403);
    connections.revokeCookie(getCookie(c, COOKIE));
    sessions.revoke(getCookie(c, COOKIE));
    await sessions.flush();
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
  app.use("/web/*", async (c, next) => {
    if (!libraryAccess.isOpen())
      return c.json(
        { error: "The Library is reopening. Reconnect when it is ready." },
        503,
      );
    const authenticatedLibrary = host.libraryId();
    const authenticatedScope = sessionScope(c.req.header("host"));
    if (!sessions.valid(getCookie(c, COOKIE), authenticatedScope))
      return c.json(
        { error: "Connect to the Circé host with your access key." },
        401,
      );
    c.set("authenticatedScope", authenticatedScope);
    c.set("authenticatedLibrary", authenticatedLibrary);
    if (
      c.req.method !== "GET" &&
      c.req.method !== "HEAD" &&
      c.req.header("origin") !== requestOrigin(c.req.header("host"))
    )
      return c.json({ error: "Origin required." }, 403);
    if (
      c.req.method !== "GET" &&
      c.req.method !== "HEAD" &&
      c.req.header("x-iris-library") !== host.libraryId()
    )
      return c.json(
        { error: "The active Library changed. Reload before editing." },
        409,
      );
    await next();
  });
  app.use("/web/inference", bodyLimit({ maxSize: 8 * 1024 * 1024 }));
  app.use("/web/connections", bodyLimit({ maxSize: 1024 }));
  app.post("/web/connections", async (c) => {
    const input = BrowserConnectionsRequestSchema.parse(await c.req.json());
    const cookie = getCookie(c, COOKIE);
    const scope = c.get("authenticatedScope");
    if (!sessions.valid(cookie, scope))
      return c.json({ error: "This browser is no longer connected." }, 401);
    return c.json(await connections.manage(input, scope, cookie));
  });
  app.post("/web/inference", async (c) =>
    host.inference
      ? host.inference(
          WebInferenceSchema.parse(await c.req.json()),
          c.req.header("x-iris-library") ?? "",
        )
      : c.notFound(),
  );
  app.get("/web/session", (c) =>
    c.json({ libraryId: host.libraryId(), fixtures: Boolean(host.fixture) }),
  );
  app.get("/web/extensions", (c) =>
    c.json({ connections: host.extension?.auth.list(host.libraryId()) ?? [] }),
  );
  app.delete("/web/extensions", async (c) => {
    await host.extension?.auth.revokeAll(host.libraryId());
    return c.json({ ok: true });
  });
  app.get("/web/capabilities", (c) =>
    c.json({ queries: WEB_QUERY_ACCESS, host: { platform: process.platform } }),
  );
  app.get("/web/history", async (c) =>
    host.history ? c.json(await host.history()) : c.notFound(),
  );
  app.post("/web/history", async (c) => {
    if (!host.history) return c.notFound();
    const input = z
      .strictObject({
        kind: z.enum(["undo", "redo"]),
        revision: z.number().int().nonnegative(),
      })
      .parse(await c.req.json());
    const result = await host.history(input);
    return result.ok === false
      ? c.json(
          {
            error:
              "The Library's edit history changed. Reload before Undo or Redo.",
          },
          409,
        )
      : c.json(result);
  });
  app.post("/web/transactions", async (c) => {
    if (!host.mutate) return c.notFound();
    const result = await host.mutate(
      WebTransactionsSchema.parse(await c.req.json()),
      c.req.header("x-iris-library") ?? "",
    );
    c.header("x-iris-history", String(result.revision));
    return c.json({ ok: true });
  });
  app.post("/web/command", async (c) =>
    host.command
      ? host.command(z.record(z.string(), z.json()).parse(await c.req.json()))
      : c.notFound(),
  );
  app.post("/web/agent", async (c) =>
    host.agent
      ? host.agent(
          agentStreamRequest.parse(await c.req.json()),
          c.req.raw.signal,
        )
      : c.notFound(),
  );
  app.put("/web/upload", async (c) =>
    host.upload
      ? host.upload(
          c.req.raw,
          decodeURIComponent(c.req.header("x-iris-filename") ?? "upload"),
          c.req.header("x-iris-library") ?? "",
        )
      : c.notFound(),
  );
  app.delete("/web/upload/:token", async (c) => {
    if (!host.removeUpload) return c.notFound();
    await host.removeUpload(
      WebUploadTokenSchema.parse(c.req.param("token")),
      c.req.header("x-iris-library") ?? "",
    );
    return c.json({ ok: true });
  });
  app.post("/web/files", async (c) =>
    host.files
      ? host.files(
          WebFileQuerySchema.parse(await c.req.json()),
          c.req.header("x-iris-library") ?? "",
        )
      : c.notFound(),
  );
  app.on(["GET", "HEAD"], "/web/download/:id", (c) => {
    const download = host.download;
    if (!download) return c.notFound();
    return libraryResponse(c.req.raw, () =>
      download(c.req.raw, c.req.param("id"), host.libraryId()),
    );
  });
  app.post("/web/query", async (c) => {
    const request = WebQueryRequestSchema.parse(await c.req.json());
    if (request.name === "settings.setPrefs")
      validateWebPreferences(request.params);
    return host.query({
      ...request,
      libraryId: c.req.header("x-iris-library"),
    });
  });
  app.post("/web/locations", async (c) =>
    host.locations
      ? host.locations(
          HostLocationsRequestSchema.parse(await c.req.json()),
          c.req.header("x-iris-library") ?? "",
          getCookie(c, COOKIE) ?? "",
        )
      : c.notFound(),
  );
  app.post("/web/watched-folder", async (c) =>
    host.watchedFolder
      ? host.watchedFolder(
          WebWatchedFolderRequestSchema.parse(await c.req.json()),
          c.req.header("x-iris-library") ?? "",
          getCookie(c, COOKIE) ?? "",
        )
      : c.notFound(),
  );
  app.post("/web/copy-library", async (c) =>
    host.copyLibrary
      ? host.copyLibrary(
          WebLibraryCopySchema.parse(await c.req.json()),
          c.req.header("x-iris-library") ?? "",
          getCookie(c, COOKIE) ?? "",
        )
      : c.notFound(),
  );
  app.post("/web/replay", async (c) => {
    if (!host.replay) return c.notFound();
    const session = getCookie(c, COOKIE) ?? "";
    const authenticatedScope = c.get("authenticatedScope");
    return host.replay(
      WebReplayRequestSchema.parse(await c.req.json()),
      {
        library: c.get("authenticatedLibrary"),
        session,
        parentOrigin: requestOrigin(c.req.header("host")) ?? host.origin,
        valid: () => sessions.valid(session, authenticatedScope),
        onRevoke: (listener) => sessions.onRevoke(session, listener),
      },
      c.req.raw.signal,
    );
  });
  app.post("/web/library", async (c) =>
    host.library
      ? host.library(
          WebLibraryRequestSchema.parse(await c.req.json()),
          c.req.header("x-iris-library") ?? "",
          getCookie(c, COOKIE) ?? "",
        )
      : c.notFound(),
  );
  app.post("/web/video", async (c) =>
    host.video
      ? host.video(
          WebVideoRequestSchema.parse(await c.req.json()),
          c.req.header("x-iris-library") ?? "",
        )
      : c.notFound(),
  );
  app.on(["GET", "HEAD"], "/web/preview/:saveId/:filename", (c) => {
    const preview = host.preview;
    if (!preview) return c.notFound();
    return libraryResponse(c.req.raw, () =>
      preview(c.req.raw, c.req.param("saveId"), c.req.param("filename")),
    );
  });
  app.on(["GET", "HEAD"], "/web/media/:saveId/*", (c) =>
    libraryResponse(c.req.raw, () =>
      host.media(
        c.req.raw,
        c.req.param("saveId"),
        decodeURIComponent(c.req.path.split("/").slice(4).join("/")),
      ),
    ),
  );
  app.get("/web/events", (c) =>
    streamSSE(c, async (stream) => {
      const session = getCookie(c, COOKIE);
      const scope = c.get("authenticatedScope");
      const queue = createWebEventQueue({
        sessionValid: () => sessions.valid(session, scope),
        scopeCurrent: () => scope === sessionScope(c.req.header("host")),
        write: (event) => stream.writeSSE(event),
        abort: () => stream.abort(),
      });
      const valid = queue.valid;
      const off = host.subscribe((action) => {
        queue.offer({ event: "sync", data: stringifyWebValue(action) });
      });
      const offStatus = host.subscribeStatus?.((event) => {
        queue.offer({ event: event.name, data: event.data });
      });
      const cleanup = () => {
        queue.dispose();
        off();
        offStatus?.();
        offRevoke();
      };
      const offRevoke = sessions.onRevoke(session, () => stream.abort());
      stream.onAbort(cleanup);
      try {
        await stream.writeSSE({
          event: "ready",
          data: c.get("authenticatedLibrary"),
        });
        if (host.history && valid() && libraryAccess.isOpen()) {
          const history = await host.history();
          if (valid())
            await stream.writeSSE({
              event: "history",
              data: stringifyWebValue(history),
            });
        }
        queue.start();
        while (!stream.aborted && valid()) {
          await stream.writeSSE({ event: "heartbeat", data: "connected" });
          await stream.sleep(15000);
        }
      } finally {
        cleanup();
      }
    }),
  );
  app.post("/web/fixtures", async (c) => {
    if (!host.fixture)
      return c.json({ error: "Fixture ingestion is disabled." }, 404);
    const { kind } = z
      .strictObject({ kind: WebFixtureSchema })
      .parse(await c.req.json());
    return c.json(await host.fixture(kind));
  });
  app.get("/_fixtures/:name", (c) => {
    if (!host.fixtureAsset || getConnInfo(c).remote.address !== "127.0.0.1")
      return c.notFound();
    return host.fixtureAsset(c.req.param("name"));
  });
  app.get("/", serveStatic({ root: host.assets, path: "browser.html" }));
  app.get("/*", serveStatic({ root: host.assets }));
  app.get("/*", async (c, next) => {
    if (c.req.path.startsWith("/web/") || c.req.path.startsWith("/assets/"))
      return c.notFound();
    const response = await serveStatic({
      root: host.assets,
      path: "browser.html",
    })(c, next);
    return response instanceof Response ? response : c.notFound();
  });
  app.onError((error, c) =>
    c.json(
      {
        error:
          error instanceof WebRequestError ||
          error instanceof LibraryTransitionError
            ? error.message
            : error instanceof z.ZodError
              ? "Invalid browser request."
              : "The host could not complete this action.",
      },
      error instanceof LibraryTransitionError
        ? 503
        : error instanceof WebRequestError
          ? error.status
          : error instanceof z.ZodError
            ? 422
            : 500,
    ),
  );
  return app;
}
