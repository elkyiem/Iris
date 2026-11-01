import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { app as electronApp } from "electron";
import log from "electron-log/main.js";
import { z } from "zod";
import { IPC } from "../../shared/constants";
import { ENRICHMENT_IPC } from "../../shared/enrichment-contracts";
import { stringifyWebValue } from "../../shared/web-serialization";
import { registerSyncActionListener } from "../core/executor";
import { getPrefs, setVideoDownloadPrefs } from "../core/prefs";
import { registerTransferDelivery } from "../core/transfer-delivery";
import { canRedo, canUndo, redo, undo, undoRevision } from "../core/undo";
import { libraryLocationOpenQueries } from "../ipc/queries/library-location-open";
import { toWireSyncAction } from "../ipc/wire";
import { subscribeBroadcast } from "../lib/broadcast";
import { resolveMainOut } from "../lib/resolve-preload";
import { libraryId, libraryRoot } from "../paths";
import { webAgentStream } from "./agent";
import { createWebApp, type WebHost } from "./app";
import { webAccessKey } from "./auth";
import { runWebCommand, WebCommandSchema } from "./commands";
import { webHostConfig } from "./config";
import { createWebConnections, registerWebConnections } from "./connections";
import { openExtensionAuth } from "./extension-auth";
import { createExtensionBridge } from "./extension-bridge";
import { createWebFiles } from "./files";
import { enqueueFixture, fixtureAsset } from "./fixtures";
import { createHostLocations } from "./host-locations";
import { runWebLibrary } from "./library";
import { createWebLibraryCopy } from "./library-copy";
import { serveWebMedia } from "./media";
import { applyWebTransactions } from "./mutations";
import { runWebQuery } from "./queries";
import { replayAssets } from "./replay-assets";
import { createReplayCache } from "./replay-cache";
import { createReplayHost } from "./replay-host";
import { createReplayRoutes } from "./replay-routes";
import { openStoredWebSessions } from "./session-storage";
import { createWebVideo } from "./video";
import { createWebWatchedFolder } from "./watched-folder";

export async function startWebHost() {
  const sandbox = process.env.POND_SANDBOX;
  if (!sandbox) throw new Error("The Circé web host requires POND_SANDBOX.");
  const { port, origin, origins } = webHostConfig(process.env);
  const replayBase = URL.parse(process.env.PORTLESS_URL ?? origin);
  if (
    !replayBase ||
    !["http:", "https:"].includes(replayBase.protocol) ||
    replayBase.username ||
    replayBase.password
  )
    throw new Error(
      "The replay host requires a valid HTTP or HTTPS app address.",
    );
  const replay = createReplayHost({
    routes: createReplayRoutes({
      appHostname: replayBase.hostname,
      domain:
        process.env.CIRCE_REPLAY_DOMAIN ??
        `replay.${process.env.PORTLESS_TLD ?? "elkyiem"}`,
      port,
    }),
    cache: createReplayCache(
      join(electronApp.getPath("userData"), "web-replay"),
    ),
    libraryId,
    assets: replayAssets({
      browser: resolveMainOut("../browser"),
      resources: electronApp.isPackaged
        ? process.resourcesPath
        : join(electronApp.getAppPath(), "resources"),
    }),
    prepare: async (input) =>
      (await import("./replay-archive")).prepareReplayArchive(input),
    warn: (error) => log.warn("[circe] archive replay cleanup failed", error),
  });
  const fixtures =
    (process.env.CIRCE_WEB_FIXTURES ?? process.env.IRIS_WEB_FIXTURES) === "1";
  const files = createWebFiles(
    join(electronApp.getPath("userData"), "web-files"),
  );
  const video = createWebVideo();
  const locations = createHostLocations({
    roots: async () => {
      const recent = await libraryLocationOpenQueries["library.recent"]();
      const configured = z
        .array(z.object({ name: z.string().min(1), path: z.string().min(1) }))
        .parse(JSON.parse(process.env.CIRCE_HOST_LOCATIONS ?? "[]"));
      return [
        { name: "Library folders", path: dirname(libraryRoot()) },
        {
          name: process.platform === "darwin" ? "Mac home" : "Home folder",
          path: homedir(),
        },
        { name: "App home", path: electronApp.getPath("home") },
        { name: "Mounted drives", path: "/Volumes" },
        ...recent
          .filter((entry) => entry.available)
          .map((entry) => ({
            name: "Other Library folders",
            path: dirname(entry.path),
          })),
        ...configured,
      ];
    },
  });

  const key = await webAccessKey(sandbox);
  const sessions = await openStoredWebSessions({
    path: join(sandbox, "web-sessions.json"),
    key,
    warn: (cause) => log.warn("[circe] browser session storage failed", cause),
  });
  await sessions.flush();
  const connectionOrigin = origin.startsWith("https:")
    ? origin
    : (origins.find((value) => value.startsWith("https:")) ?? origin);
  const connections = createWebConnections({
    sessions,
    origin: connectionOrigin,
    libraryId,
  });
  const copyLibrary = createWebLibraryCopy({
    locations,
    libraryId,
    copy: async (ids, destination) => {
      const [{ runTransferJob }, { copySaveSelectionToLibrary }] =
        await Promise.all([
          import("../core/transfer-jobs"),
          import("../core/transfer-operations"),
        ]);
      try {
        return {
          ok: true,
          ...(await runTransferJob(
            { kind: "copy_library", origin: libraryRoot(), destination, ids },
            () => copySaveSelectionToLibrary(ids, destination),
          )),
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : "Could not copy Saves.",
        };
      }
    },
  });
  const watchedFolder = createWebWatchedFolder({
    locations,
    libraryId,
    read: async () => (await getPrefs()).autoImport,
    configure: async (patch) =>
      (await import("../core/auto-import")).configureAutoImport(patch),
  });
  const extension = createExtensionBridge(
    await openExtensionAuth({
      path: join(sandbox, "extension-connections.json"),
      key,
    }),
  );
  if (fixtures) await setVideoDownloadPrefs({ autoDownload: true }, "twitter");
  const config: WebHost = {
    replay: async (input, scope, signal) =>
      Response.json(await replay.request(input, scope, signal)),
    copyLibrary: async (input, expected, session) =>
      Response.json(await copyLibrary(input, expected, session)),
    origin,
    origins,
    key,
    sessions,
    connections,
    extension: extension.host,
    assets: resolveMainOut("../browser"),
    libraryId,
    watchedFolder: async (input, expected, session) =>
      Response.json(await watchedFolder(input, expected, session)),
    inference: async (input, expected) =>
      new Response(stringifyWebValue(await files.infer(input, expected)), {
        headers: { "content-type": "application/json" },
      }),
    locations: async (input, expected, session) => {
      const scope = { library: expected, session };
      if (input.action === "recent") {
        const recent = await libraryLocationOpenQueries["library.recent"]();
        const entries = await Promise.all(
          recent.map(async (entry) => ({
            entry,
            source: entry.available
              ? (await locations.known(entry.path, "open", scope)).handle
              : null,
          })),
        );
        return Response.json(entries);
      }
      if (input.action === "inspect")
        return Response.json(
          await locations.known(dirname(libraryRoot()), "inspect", scope),
        );
      return Response.json(
        input.action === "mkdir"
          ? await locations.mkdir(input, scope)
          : await locations.list(input, scope),
      );
    },
    library: async (input, expected, session) =>
      Response.json(await runWebLibrary(input, expected, session, locations)),
    query: async (request) => {
      const reply = await runWebQuery(request);
      const headers = new Headers({ "content-type": "application/json" });
      if (reply.revision !== undefined)
        headers.set("x-iris-history", String(reply.revision));
      return new Response(stringifyWebValue(reply.value), {
        headers,
      });
    },
    history: async (action) => {
      const ok = action
        ? await (action.kind === "undo"
            ? undo(action.revision)
            : redo(action.revision))
        : undefined;
      return {
        ok,
        revision: undoRevision(),
        canUndo: canUndo(),
        canRedo: canRedo(),
      };
    },
    mutate: applyWebTransactions,
    command: async (input) =>
      new Response(
        stringifyWebValue(
          await runWebCommand(
            WebCommandSchema.parse(input),
            extension.connectSource,
          ),
        ),
        { headers: { "content-type": "application/json" } },
      ),
    agent: webAgentStream,
    removeUpload: files.removeUpload,
    upload: async (request, filename, expected) =>
      Response.json(await files.upload(request, filename, expected)),
    files: files.query,
    download: files.download,
    video: video.query,
    preview: video.media,
    subscribeStatus: (listener) =>
      subscribeBroadcast((channel, payload) => {
        const names = new Map<string, string>([
          [IPC.prefsChanged, "prefs"],
          [IPC.historyChanged, "history"],
          [ENRICHMENT_IPC.status, "enrichment"],
          [IPC.libraryIdentityChanged, "library-identity"],
          [IPC.fish, "fish"],
          [IPC.fishOpen, "fish-open"],
          [IPC.sessionImported, "session-imported"],
          [IPC.sessionImportFailed, "session-failed"],
          [IPC.syncStatus, "source-sync"],
          [IPC.storageStatus, "storage"],
          [IPC.updateNotice, "update"],
          [IPC.eagleImportProgress, "import-progress"],
          [IPC.agentFilter, "agent-filter"],
          [IPC.agentCite, "agent-cite"],
          [IPC.agentOverlay, "agent-overlay"],
        ]);
        const name = names.get(channel);
        if (name) listener({ name, data: stringifyWebValue(payload) });
      }),
    media: serveWebMedia,
    subscribe: (listener) =>
      registerSyncActionListener((action) =>
        listener(toWireSyncAction(action)),
      ),
  };
  if (fixtures) {
    config.fixture = (kind) => enqueueFixture(kind, `http://127.0.0.1:${port}`);
    config.fixtureAsset = fixtureAsset;
  }
  const app = createWebApp(config);
  const server = serve({
    fetch: async (request, env) => {
      try {
        return (await replay.handle(request)) ?? app.fetch(request, env);
      } catch (error) {
        log.warn("[circe] archive request failed", error);
        return new Response(
          "This archive is unavailable. Reopen it from Circé.",
          {
            status: 503,
            headers: {
              "cache-control": "no-store",
              "content-type": "text/plain",
              "x-content-type-options": "nosniff",
            },
          },
        );
      }
    },
    hostname: "127.0.0.1",
    port,
  });
  server.once("close", extension.close);
  server.once(
    "close",
    () =>
      void replay
        .close()
        .catch((error: Error) =>
          log.warn("[circe] archive close failed", error),
        ),
  );
  const unregisterTransfers = registerTransferDelivery(files.transferJobs);
  const unregisterConnections = registerWebConnections(connections);
  const closeOwners = async () => {
    unregisterTransfers();
    unregisterConnections();
    await Promise.all([sessions.close(), replay.close()]);
  };
  server.once("close", () => {
    void closeOwners().catch((cause) =>
      log.warn("[circe] web owner close failed", cause),
    );
  });
  return Object.assign(server, { closeReplay: closeOwners });
}
