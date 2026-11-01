import type { SyncSourceStatus } from "@/features/sources/state/sync-monitor";
import { relativeTime } from "@/shared/lib/relative-time";

type CardTone = "run" | "ok" | "err" | "idle" | "paused";

export interface CardModel {
  tone: CardTone;
  statusText: string;
  connected: boolean;
  meta: string;
  lastText: string;
}

export function cardModel(status: SyncSourceStatus | undefined): CardModel {
  const state = status?.state ?? "idle";
  const connected = status?.connected ?? false;
  const lastText = status?.lastSyncedAt
    ? relativeTime(status.lastSyncedAt)
    : "—";

  if (state === "running") {
    return {
      tone: "run",
      statusText: status?.message ?? "Syncing",
      connected: true,
      meta: "now",
      lastText: "now",
    };
  }
  if (state === "auth_required") {
    return {
      tone: "paused",
      statusText: "Expired",
      connected,
      meta: "Sign in again",
      lastText,
    };
  }
  if (state === "paused") {
    return {
      tone: "paused",
      statusText: "Paused",
      connected,
      meta: status?.message ?? "Backing off",
      lastText,
    };
  }
  if (state === "error") {
    return {
      tone: "err",
      statusText: "Failed",
      connected,
      meta: status?.lastError ?? "Sync failed. Try again.",
      lastText,
    };
  }
  if (!connected) {
    return {
      tone: "idle",
      statusText: "Offline",
      connected: false,
      meta: "Set up to sync",
      lastText: "—",
    };
  }
  if (state === "done") {
    return {
      tone: "ok",
      statusText: "Synced",
      connected,
      meta: "Manual",
      lastText,
    };
  }
  return {
    tone: "idle",
    statusText: status?.lastSyncedAt ? "Ready" : "Connected",
    connected,
    meta: "Manual",
    lastText,
  };
}
