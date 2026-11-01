import { sourceLabel } from "@pond/schema/sources";
import type { DownloadRow } from "@/features/downloads/lib/status-feed";
import { formatPlural } from "@/shared/lib/format";

export type DownloadTableStatus =
  | "progress"
  | "failed"
  | "complete"
  | "paused"
  | "cancelled"
  | "skipped";

const STATUS_LABELS = {
  progress: "In Progress",
  failed: "Failed",
  complete: "Completed",
  paused: "Paused",
  cancelled: "Canceled",
  skipped: "Skipped",
} satisfies Record<DownloadTableStatus, string>;

function isDownloadWaiting(row: DownloadRow): boolean {
  return (
    row.status === "waiting" ||
    row.status === "parked" ||
    row.status === "blocked" ||
    row.status === "retrying"
  );
}

export function isDownloadStopped(row: DownloadRow, paused: boolean): boolean {
  return paused && isDownloadWaiting(row) && !row.interactive;
}

export function isDownloadProcessing(row: DownloadRow): boolean {
  return (
    row.op === "ensure_poster" ||
    row.op === "render_text_cover" ||
    row.op === "finalize"
  );
}

export function downloadTableStatus(
  row: DownloadRow,
  paused: boolean,
): DownloadTableStatus {
  if (row.status === "complete") return "complete";
  if (
    row.status === "failed" ||
    row.status === "blocked" ||
    row.status === "dead"
  )
    return "failed";
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "skipped") return "skipped";
  if (isDownloadStopped(row, paused)) return "paused";
  return "progress";
}

export function downloadStatusLabel(row: DownloadRow, paused: boolean): string {
  if (isDownloadStopped(row, paused)) return "Paused";
  if (row.status === "waiting") return "Waiting";
  if (row.status === "parked") {
    const source = sourceLabel(row.source);
    if (row.deferredReason === "source_budget") {
      if (row.nextRunAt == null || row.nextRunAt <= Date.now())
        return `Checking ${source} limit`;
      return `${source} limit · ${waitDuration(row.nextRunAt)}`;
    }
    return `Waiting for ${source}`;
  }
  if (row.status === "retrying") {
    if (row.nextRunAt == null) return "Retrying";
    return `Retrying in ${waitDuration(row.nextRunAt)}`;
  }
  if (row.status === "dead")
    return `Stopped after ${formatPlural(row.attempts, { one: "attempt", other: "attempts" })}`;
  return STATUS_LABELS[downloadTableStatus(row, paused)];
}

function waitDuration(nextRunAt: number): string {
  const seconds = Math.max(0, Math.ceil((nextRunAt - Date.now()) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.ceil(minutes / 60)}h`;
}
