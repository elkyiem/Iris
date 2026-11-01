import { IconCircleCheck, IconCircleWarning, IconPowerOff } from "@pond/icons";
import { Button, Loader, Settings, Tooltip } from "@pond/ui";
import { useState } from "react";
import { useEnrichmentStatus } from "@/features/enrichment/status";
import { formatPlural } from "@/shared/lib/format";
import { hostDeviceName } from "@/shared/lib/platform";
import { usePrefs } from "@/shared/state/prefs";
import styles from "./styles.module.css";

const TASKS = { one: "task", other: "tasks" };

const TASK_LABELS = new Map<string, string>([
  ["caption", "Image Captions"],
  ["ocr", "Text in Images"],
  ["transcript", "Transcription"],
  ["clip", "Visual Similarity"],
  ["aesthetic", "Style Labels"],
  ["sensitive-content", "Sensitive Content"],
  ["autoTitle", "Generated Titles"],
  ["suggestedTags", "Suggested Tags"],
  ["textEmbedding", "Semantic Search"],
]);

interface TaskGroup {
  label: string;
  left: number;
  failed: number;
}

function taskGroups(
  active: ReadonlySet<string>,
  failed: ReadonlySet<string>,
): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  const group = (key: string) => {
    const id = key.slice(0, key.indexOf(":"));
    const existing = groups.get(id);
    if (existing) return existing;
    const next = { label: TASK_LABELS.get(id) ?? id, left: 0, failed: 0 };
    groups.set(id, next);
    return next;
  };
  for (const key of active) group(key).left += 1;
  for (const key of failed) group(key).failed += 1;
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function groupStatus(group: TaskGroup): string {
  const parts: string[] = [];
  if (group.left) parts.push(`${group.left.toLocaleString()} left`);
  if (group.failed) parts.push(`${group.failed.toLocaleString()} failed`);
  return parts.join(", ");
}

async function checkLibrary(): Promise<void> {
  const { runEnrichment } = await import("@/features/enrichment");
  await runEnrichment();
}

export function ProcessingStatus() {
  const status = useEnrichmentStatus();
  const [ai, , loaded] = usePrefs("ai");
  const enabled =
    ai.semanticSearch ||
    ai.enableCaption ||
    ai.enableOcr ||
    ai.enableTranscript ||
    ai.enableClip ||
    ai.enableSensitiveContent ||
    ai.enableAutoTitle;
  return (
    <ProcessingStatusCard
      status={status}
      enabled={enabled}
      loaded={loaded}
      onCheck={checkLibrary}
    />
  );
}

export function ProcessingStatusCard({
  status,
  enabled,
  loaded = true,
  onCheck,
}: {
  status: ReturnType<typeof useEnrichmentStatus>;
  enabled: boolean;
  loaded?: boolean;
  onCheck: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const busy = checking || status.inflight > 0 || status.state === "starting";
  const ownerFailed = status.state === "failed";
  const failed = status.failedKeys.size;
  const groups = taskGroups(status.activeKeys, status.failedKeys);
  const state =
    !loaded || busy
      ? "processing"
      : checkFailed || ownerFailed || failed
        ? "attention"
        : enabled
          ? "ready"
          : "off";
  const title = !loaded
    ? "Loading processing settings"
    : status.state === "starting"
      ? "Starting library processing"
      : status.state === "paused"
        ? "Library processing is paused"
        : checking
          ? "Checking your library"
          : status.inflight > 0
            ? "Processing your library"
            : checkFailed || ownerFailed
              ? "Couldn't check your library"
              : failed
                ? "Processing needs attention"
                : enabled
                  ? "Ready for new items"
                  : "Local processing is off";
  const detail = !loaded
    ? "Getting your processing preferences."
    : status.state === "starting"
      ? `Starting processing on ${hostDeviceName()}.`
      : status.state === "paused"
        ? "Processing resumes when the host is available."
        : checking
          ? "Looking for saves that need processing."
          : status.inflight > 0
            ? `${formatPlural(status.inflight, TASKS)} left`
            : checkFailed || ownerFailed
              ? (status.error ?? "Try checking the library again.")
              : failed
                ? `${formatPlural(failed, TASKS)} couldn't finish`
                : enabled
                  ? `New saves are processed on ${hostDeviceName()}.`
                  : "Turn on a processing option below to get started.";
  const canRetry =
    loaded && enabled && !busy && (failed > 0 || checkFailed || ownerFailed);

  async function handleCheck() {
    setChecking(true);
    setCheckFailed(false);
    try {
      await onCheck();
    } catch {
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  }

  return (
    <Settings.List className={styles.card} data-state={state}>
      <div className={styles.row}>
        <span className={styles.indicator} aria-hidden="true">
          {state === "processing" ? (
            <Loader.Spinner />
          ) : state === "attention" ? (
            <IconCircleWarning />
          ) : state === "off" ? (
            <IconPowerOff />
          ) : (
            <IconCircleCheck />
          )}
        </span>
        <div className={styles.copy} aria-live="polite" aria-atomic="true">
          <Settings.ItemTitle className={styles.title}>
            {title}
          </Settings.ItemTitle>
          <p className={styles.detail}>
            <span>{detail}</span>
            {groups.length > 0 ? (
              <Tooltip.Info
                side="top"
                aria-label="Task Details"
                label={
                  <span className={styles.breakdown}>
                    {groups.map((group) => (
                      <span key={group.label} className={styles.group}>
                        <span>{group.label}</span>
                        <span className={styles.value}>
                          {groupStatus(group)}
                        </span>
                      </span>
                    ))}
                  </span>
                }
              />
            ) : null}
          </p>
        </div>
        <Button
          className={styles.action}
          size="sm"
          variant="secondary"
          disabled={!loaded || !enabled || busy}
          onClick={() => void handleCheck()}
        >
          {checking ? "Checking Library" : canRetry ? "Retry" : "Check Library"}
        </Button>
      </div>
    </Settings.List>
  );
}
