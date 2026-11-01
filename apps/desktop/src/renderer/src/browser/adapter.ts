import { PrefsSchema } from "@pond/schema";
import type { Query } from "@pond/schema/filters/types";
import { agentStreamRequest } from "@shared/assistant";
import {
  type EnrichmentStatus,
  HostInferenceSchema,
} from "@shared/enrichment-contracts";
import type { QueryClient, QueryResult } from "@shared/query-contracts";
import type { EagleImportProgress } from "@shared/saves-import-contracts";
import type { UpdateNotice } from "@shared/update-notice";
import { WebQueryNameSchema } from "@shared/web-contracts";
import { WebHistorySchema } from "@shared/web-mutations";
import { parseWebValue, type WebValue } from "@shared/web-serialization";
import type {
  WireJson,
  WireSessionImported,
  WireSessionImportFailed,
  WireSyncAction,
  WireSyncStatusUpdate,
} from "@shared/wire";
import { z } from "zod";
import defaultAppIcon from "@/generated/app-icon-previews/aqua.png";
import { version } from "../../../../package.json";
import type { PondApi, StorageGuardStatusWire } from "../../../preload";
import { createBrowserCanvases } from "./canvases";
import { openBrowserCombine } from "./combine-images";
import { createBrowserConnections } from "./connections";
import { onBrowserEditRequest } from "./edit-requests";
import { browserFeedback } from "./feedback";
import { createBrowserFiles } from "./files";
import { createBrowserInference } from "./inference";
import { followBrowserInterfaceZoom } from "./interface-zoom";
import { createBrowserLibrary, LibraryClientParamsSchema } from "./library";
import { createBrowserPreferences } from "./preferences";
import { createBrowserPreviews } from "./previews";
import { installBrowserReplay } from "./replay";
import { createBrowserWatchedFolder } from "./watched-folder";

let boundLibraryId = "";
let historyRevision = 0;
let historySnapshot: ReturnType<typeof WebHistorySchema.parse> | null = null;
let historyCommands: Promise<void> = Promise.resolve();

function receiveHistory(state: ReturnType<typeof WebHistorySchema.parse>) {
  if (state.revision < historyRevision) return;
  historyRevision = state.revision;
  historySnapshot = state;
}

function runHistory(kind: "undo" | "redo") {
  const library = boundLibraryId;
  const operation = historyCommands.then(async () => {
    if (library !== boundLibraryId)
      throw new Error(
        "The active Library changed. Reload before Undo or Redo.",
      );
    if (
      historySnapshot?.revision === historyRevision &&
      !(kind === "undo" ? historySnapshot.canUndo : historySnapshot.canRedo)
    )
      return { ok: false, ...historySnapshot };
    const state = WebHistorySchema.parse(
      await webRequest(
        "history",
        JSON.stringify({ kind, revision: historyRevision }),
      ),
    );
    receiveHistory(state);
    return { ok: true, ...state };
  });
  historyCommands = operation.then(
    () => {},
    () => {},
  );
  return operation;
}

export async function webRequest(path: string, body?: string, method = "POST") {
  const response = await fetch(
    `/web/${path}`,
    body === undefined
      ? {}
      : {
          method,
          headers: webHeaders(),
          body,
        },
  );
  const revision = response.headers.get("x-iris-history");
  if (
    revision !== null &&
    Number.isSafeInteger(Number(revision)) &&
    Number(revision) >= 0
  )
    historyRevision = Math.max(historyRevision, Number(revision));
  if (!response.ok) {
    const result = parseWebValue(await response.text());
    const failure = z.object({ error: z.string() }).safeParse(result);
    const message =
      response.status === 401 && path !== "session" && path !== "pair"
        ? "Your host session has expired. Reload to reconnect."
        : failure.success
          ? failure.data.error
          : "The host could not complete this action.";
    window.dispatchEvent(new CustomEvent("iris-error", { detail: message }));
    throw new Error(message);
  }
  return parseWebValue(await response.text());
}

function unsupported(): never {
  const message =
    "This action needs the Circé desktop host. Open it on the host computer to continue.";
  window.dispatchEvent(new CustomEvent("iris-error", { detail: message }));
  throw new Error(message);
}

/** Native menu and window events have no producers on the visiting device. */
const noNativeEvents = () => () => {};

export async function installBrowserAdapter(libraryId: string) {
  boundLibraryId = libraryId;
  installBrowserReplay({ request: webRequest, headers: webHeaders });
  const capabilities = z
    .object({ host: z.object({ platform: z.string() }) })
    .parse(await webRequest("capabilities"));
  document.documentElement.dataset.hostPlatform = capabilities.host.platform;
  const hostPrefs = PrefsSchema.parse(
    await webRequest("query", JSON.stringify({ name: "settings.getPrefs" })),
  );
  const initialHistory = WebHistorySchema.parse(await webRequest("history"));
  historyRevision = initialHistory.revision;
  historySnapshot = initialHistory;
  historyCommands = Promise.resolve();
  const key = `iris:device-prefs:${libraryId}`;
  const preferences = createBrowserPreferences({
    platform: navigator.platform,
    initial: hostPrefs,
    readDevice: () => localStorage.getItem(key),
    writeDevice: (value) => localStorage.setItem(key, value),
    saveHost: async (patch) =>
      z
        .object({ prefs: PrefsSchema })
        .parse(
          await webRequest(
            "query",
            JSON.stringify({ name: "settings.setPrefs", params: patch }),
          ),
        ).prefs,
  });
  const syncListeners = new Set<(event: WireSyncAction) => void>();
  const stopZoom = followBrowserInterfaceZoom(preferences);
  window.addEventListener("pagehide", stopZoom, { once: true });
  const eagleListeners = new Set<(event: EagleImportProgress) => void>();
  const files = createBrowserFiles({
    request: webRequest,
    headers: webHeaders,
    eagleProgress: (value) => {
      for (const listener of eagleListeners) listener(value);
    },
  });
  const canvases = createBrowserCanvases(webRequest);
  const libraries = createBrowserLibrary(webRequest);
  const connections = createBrowserConnections(webRequest);
  const watchedFolder = createBrowserWatchedFolder(webRequest);
  const infer = createBrowserInference({
    request: webRequest,
    headers: webHeaders,
  });
  const query: QueryClient = async (name, ...args) => {
    let result:
      | WebValue
      | QueryResult<"settings.getPrefs">
      | QueryResult<"settings.setPrefs"> = null;
    if (connections.handles(name))
      result = await connections.query(
        name,
        z.record(z.string(), z.json()).parse(args[0] ?? {}),
      );
    else if (name === "enrichment.infer")
      result = await infer(HostInferenceSchema.parse(args[0]));
    else if (watchedFolder.handles(name))
      result = await watchedFolder.query(
        name,
        z.record(z.string(), z.json()).parse(args[0] ?? {}),
      );
    else if (libraries.handles(name))
      result = await libraries.query(
        name,
        LibraryClientParamsSchema.parse(args[0] ?? {}),
      );
    else if (files.handles(name))
      result = await files.query(
        name,
        z.record(z.string(), z.json()).parse(args[0] ?? {}),
      );
    else if (canvases.handles(name))
      result = await canvases.query(
        name,
        z.record(z.string(), z.json()).parse(args[0] ?? {}),
      );
    else if (name === "settings.getPrefs") result = preferences.read();
    else if (name === "feedback.emit")
      result = browserFeedback(
        z.record(z.string(), z.json()).parse(args[0]),
        preferences.read(),
      );
    // A visiting browser cannot detect native MCP clients on its device.
    else if (name === "agent.mcpClients") result = { clients: [] };
    else if (name === "settings.setPrefs") {
      const patch = z
        .record(z.string(), z.record(z.string(), z.json()))
        .parse(args[0]);
      result = { ok: true, prefs: await preferences.write(patch) };
    } else {
      if (!WebQueryNameSchema.safeParse(name).success) return unsupported();
      result = await webRequest(
        "query",
        JSON.stringify({ name, params: args[0] ?? {} }),
      );
    }
    if (name === "library.info" || name === "library.identity.update") {
      const identity = z
        .object({ icon: z.string().nullable() })
        .safeParse(result);
      const favicon = document.querySelector('link[rel="icon"]');
      if (identity.success && favicon instanceof HTMLLinkElement)
        favicon.href = identity.data.icon ?? defaultAppIcon;
    }
    /** SAFETY: the name is checked against the shared allowlist; host handlers validate inputs and retain QueryResults. Local prefs use PrefsSchema. */
    return result as QueryResult<typeof name>;
  };
  const previews = createBrowserPreviews({
    query,
    exportFile: async (id, fileIndex) => {
      await files.query("saves.exportFile", { id, fileIndex });
    },
    isCurrent: () => boundLibraryId === libraryId,
    reduceMotion: () => preferences.read().preferences.reduceMotion,
  });
  window.addEventListener("pagehide", () => previews.dispose(), { once: true });
  const api: PondApi = {
    query,
    libraryId: () => libraryId,
    onSyncAction: (callback) => {
      syncListeners.add(callback);
      return () => syncListeners.delete(callback);
    },
    onPrefsChanged: (callback) => {
      return preferences.subscribe(callback);
    },
    onLibraryIdentityChanged: (callback) =>
      onEvent("library-identity", callback),
    rendererReady: () => {},
    sendMenuRecents: () => {},
    openExternal: async (url) => {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return unsupported();
      const opened = window.open("about:blank", "_blank");
      if (!opened) {
        window.dispatchEvent(
          new CustomEvent("iris-error", {
            detail:
              "The browser blocked the new tab. Allow popups for Circé and try again.",
          }),
        );
        return { ok: false };
      }
      opened.opener = null;
      opened.location.replace(parsed.href);
      return { ok: true };
    },
    appInfo: async () => ({
      name: "Circé",
      version: `${version}-web`,
      platform: "browser",
      arch: "browser",
      username: "",
      isPackaged: false,
    }),
    openCombineImagesWindow: async (input) => {
      openBrowserCombine(input);
    },
    tx: async (transaction) => {
      await webRequest(
        "transactions",
        JSON.stringify({ transactions: [transaction] }),
      );
    },
    batch: async (transactions) => {
      if (transactions.length)
        await webRequest("transactions", JSON.stringify({ transactions }));
    },
    undo: () => runHistory("undo"),
    redo: () => runHistory("redo"),
    openPreviewWindow: previews.open,
    configurePreviewWindow: previews.configure,
    navigatePreviewWindow: previews.navigate,
    closePreviewWindow: previews.close,
    pathForFile: files.pathForFile,
    revealSave: async (id) => {
      location.assign(`/save/${encodeURIComponent(id)}`);
      return { ok: true };
    },
    openSaveFile: async (id, fileIndex) => {
      await files.query("saves.exportFile", {
        id,
        fileIndex: fileIndex ?? 0,
      });
      return { ok: true };
    },
    refreshSave: (id) => command("refreshSave", { id }),
    refreshBackfillStart: (opts) => command("refreshBackfillStart", opts ?? {}),
    refreshBackfillCancel: () => command("refreshBackfillCancel"),
    pipelinePause: (paused) => command("pipelinePause", { paused }),
    pipelineCancelSaves: (ids) =>
      command("pipelineCancelSaves", { ids: [...ids] }),
    pipelineCancelAll: () => command("pipelineCancelAll"),
    connectSource: async (source) => {
      const result = await command("connectSource", { source });
      if (result.ok && result.mode === "extension")
        window.postMessage(
          { type: "iris-connect-source", source },
          window.location.origin,
        );
      return result;
    },
    connectSourceHandle: (source, handle) =>
      command("connectSourceHandle", { source, handle }),
    clearPendingSession: (source) => command("clearPendingSession", { source }),
    sourceStatus: (source) => command("sourceStatus", { source }),
    syncRunNow: (accountId, opts) =>
      command("syncRunNow", { accountId, ...opts }),
    syncStatus: (accountId) => command("syncStatus", { accountId }),
    syncRunAll: (opts) => command("syncRunAll", opts ?? {}),
    syncCancel: (accountId) => command("syncCancel", { accountId }),
    governorSetPaused: (paused) => command("governorSetPaused", { paused }),
    governorResumeSource: (source) =>
      command("governorResumeSource", { source }),
    archiveBackfillStart: () => command("archiveBackfillStart"),
    archiveSite: (id) => command("archiveSite", { id }),
    agentStream: (body, receive) => {
      const input = agentStreamRequest.parse(body);
      const controller = new AbortController();
      void fetch("/web/agent", {
        method: "POST",
        headers: webHeaders(),
        body: JSON.stringify(input),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(
              "The host could not start this reply. Reconnect and try again.",
            );
          const reader = response.body?.getReader();
          if (!reader) throw new Error("The host returned an empty reply.");
          while (!controller.signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done) {
              receive({ type: "end" });
              return;
            }
            receive({ type: "data", data: Array.from(chunk.value) });
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            receive({
              type: "error",
              error:
                error instanceof Error
                  ? error.message
                  : "Could not read the reply.",
            });
        });
      return () => {
        controller.abort();
        void webRequest(
          "query",
          JSON.stringify({
            name: "agent.stop",
            params: { chatId: input.chatId, requestId: input.requestId },
          }),
        ).catch(() => {});
      };
    },
    onPreviewNeighborRequested: previews.subscribe,
    onNavigate: noNativeEvents,
    onFullScreenChange: noNativeEvents,
    onNavigationSwipe: noNativeEvents,
    onOpenFiles: noNativeEvents,
    onEditUndoRequested: (callback) => onBrowserEditRequest("undo", callback),
    onEditRedoRequested: (callback) => onBrowserEditRequest("redo", callback),
    onMenuAction: noNativeEvents,
    onShortcutAction: noNativeEvents,
    onMenuOpenSave: noNativeEvents,
    onEagleImportProgress: (callback) => {
      eagleListeners.add(callback);
      const off = onEvent("import-progress", callback);
      return () => {
        eagleListeners.delete(callback);
        off();
      };
    },
    onSessionImported: (callback) => onEvent("session-imported", callback),
    onSessionImportFailed: (callback) => onEvent("session-failed", callback),
    onSyncStatus: (callback) => onEvent("source-sync", callback),
    onStorageStatus: (callback) => onEvent("storage", callback),
    onUpdateNotice: (callback) => onEvent("update", callback),
    // Visibility and focus come from this device; browsers expose no thermal API.
    machinePace: async () => ({ thermal: "unknown", onBattery: false }),
    onMachinePace: noNativeEvents,
    onArchiveNavigate: noNativeEvents,
    onEnrichmentStatus: (callback) => onEvent("enrichment", callback),
    onFish: (callback) => onEvent("fish", callback),
    onFishOpen: (callback) => onEvent("fish-open", callback),
    onAgentChunk: noNativeEvents,
    onAgentFilter: (callback) => onEvent("agent-filter", callback),
    onAgentCite: (callback) => onEvent("agent-cite", callback),
    onAgentOverlay: (callback) => onEvent("agent-overlay", callback),
  };
  window.pond = api;
  document.documentElement.dataset.runtime = "browser";
  const events = new EventSource("/web/events");
  function onEvent<Name extends keyof BrowserHostEvents>(
    name: Name,
    callback: (value: BrowserHostEvents[Name]) => void,
  ) {
    const receive = (event: MessageEvent<string>) => {
      /** SAFETY: the host forwards only the named, typed IPC broadcast for this event. */
      callback(parseWebValue(event.data) as BrowserHostEvents[Name]);
    };
    events.addEventListener(name, receive);
    return () => events.removeEventListener(name, receive);
  }
  events.addEventListener("prefs", (event) => {
    preferences.receiveHost(PrefsSchema.parse(parseWebValue(event.data)));
  });
  events.addEventListener("history", (event) => {
    receiveHistory(WebHistorySchema.parse(parseWebValue(event.data)));
  });
  let connected = false;
  events.addEventListener("ready", () => {
    // Refresh the pool after a gap rather than silently losing host mutations.
    if (connected) location.reload();
    connected = true;
    window.dispatchEvent(
      new CustomEvent("iris-connection", {
        detail: "Connected to Circé",
      }),
    );
  });
  events.addEventListener("sync", (event) => {
    /** SAFETY: this same-origin authenticated event is emitted by toWireSyncAction on the host. */
    const action = parseWebValue(event.data) as WireSyncAction;
    for (const listener of syncListeners) listener(action);
  });
  events.onerror = () => {
    window.dispatchEvent(
      new CustomEvent("iris-connection", {
        detail: "Host disconnected · reconnecting…",
      }),
    );
    void fetch("/web/session")
      .then((response) => {
        if (response.status === 401)
          window.dispatchEvent(
            new CustomEvent("iris-error", {
              detail: "Your host session has expired. Reload to reconnect.",
            }),
          );
      })
      .catch(() => {});
  };
  window.addEventListener("pagehide", () => events.close(), { once: true });
  window.addEventListener("pageshow", (event) => {
    // A restored page has a closed stream and can refer to a previous host or Library.
    if (event.persisted) location.reload();
  });
}

function webHeaders() {
  return {
    "content-type": "application/json",
    "x-iris-library": boundLibraryId,
  };
}

type CommandName =
  | "refreshSave"
  | "refreshBackfillStart"
  | "refreshBackfillCancel"
  | "pipelinePause"
  | "pipelineCancelSaves"
  | "pipelineCancelAll"
  | "connectSourceHandle"
  | "connectSource"
  | "clearPendingSession"
  | "sourceStatus"
  | "syncRunNow"
  | "syncStatus"
  | "syncRunAll"
  | "syncCancel"
  | "governorSetPaused"
  | "governorResumeSource"
  | "archiveBackfillStart"
  | "archiveSite";
async function command<Name extends CommandName>(
  name: Name,
  params: { [key: string]: WireJson | undefined } = {},
): Promise<Awaited<ReturnType<PondApi[Name]>>> {
  const result = await webRequest(
    "command",
    JSON.stringify({ name, ...params }),
  );
  /** SAFETY: command names select the corresponding existing host operation; WebCommandSchema validates the request. */
  return result as Awaited<ReturnType<PondApi[Name]>>;
}

interface BrowserHostEvents {
  enrichment: EnrichmentStatus;
  "library-identity": string;
  fish: Parameters<Parameters<PondApi["onFish"]>[0]>[0];
  "fish-open": Parameters<Parameters<PondApi["onFishOpen"]>[0]>[0];
  "import-progress": EagleImportProgress;
  "session-imported": WireSessionImported;
  "session-failed": WireSessionImportFailed;
  "source-sync": WireSyncStatusUpdate;
  storage: StorageGuardStatusWire;
  update: UpdateNotice;
  "agent-filter": Query;
  "agent-cite": string[];
  "agent-overlay": Parameters<Parameters<PondApi["onAgentOverlay"]>[0]>[0];
}
