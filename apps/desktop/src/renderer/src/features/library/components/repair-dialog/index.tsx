import { Dialog } from "@pond/ui";
import type {
  LibraryRepairJob,
  LibraryRepairKind,
} from "@shared/library-repair-contracts";
import { useEffect, useRef, useState } from "react";
import { errorCopy } from "@/shared/lib/error-copy";
import { formatPlural } from "@/shared/lib/format";
import styles from "./styles.module.css";

const LABELS = {
  thumbnails: "Repair Thumbnails",
  "physical-file-names": "Repair Physical File Names",
  "invalid-content": "Repair Invalid Content",
  "save-metadata": "Repair Save Metadata",
} satisfies Record<LibraryRepairKind, string>;

const DESCRIPTIONS = {
  thumbnails:
    "Pond rebuilds missing or damaged thumbnails from each save's original file.",
  "physical-file-names":
    "Pond renames files on disk whose names other computers can't store.",
  "invalid-content":
    "Saves whose files are all missing or damaged move to Trash.",
  "save-metadata":
    "Pond rewrites the record stored with each save when it no longer matches your library.",
} satisfies Record<LibraryRepairKind, string>;

async function cancelRetiredJob(id: string): Promise<void> {
  try {
    await window.pond.query("libraryRepairs.cancel", { id });
  } catch (cause) {
    console.warn("Could not cancel a closed Library repair", cause);
  }
}

export function LibraryRepairDialog({
  kind,
  open,
  onClose,
}: {
  kind: LibraryRepairKind;
  open: boolean;
  onClose: () => void;
}) {
  const [job, setJob] = useState<LibraryRepairJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const generation = useRef(0);
  const running =
    starting || job?.status === "queued" || job?.status === "running";
  const preview = job?.preview;
  const completed = job?.phase === "apply" && job.status === "completed";

  useEffect(() => {
    const current = ++generation.current;
    if (!open) return;
    setJob(null);
    setError(null);
    setStarting(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const failed = (cause: Error) => {
      if (current !== generation.current) return;
      setStarting(false);
      setError(
        errorCopy(cause, "Pond couldn't check your library. Try again."),
      );
    };
    async function track(id: string): Promise<void> {
      try {
        const next = await window.pond.query("libraryRepairs.get", { id });
        if (current !== generation.current) return;
        if (!next)
          throw new Error(
            "This Library check is no longer available. Close it and preview again.",
          );
        setJob(next);
        if (next.status === "queued" || next.status === "running") {
          timer = setTimeout(() => void track(id), 200);
        }
      } catch (cause) {
        if (cause instanceof Error) failed(cause);
        else failed(new Error("Pond couldn't check your library. Try again."));
      }
    }
    void window.pond
      .query("libraryRepairs.preview", { kind })
      .then(async (next) => {
        if (current !== generation.current) {
          await cancelRetiredJob(next.id);
          return;
        }
        setStarting(false);
        setJob(next);
        return track(next.id);
      })
      .catch(failed);
    return () => {
      if (current === generation.current) generation.current++;
      if (timer) clearTimeout(timer);
    };
  }, [kind, open]);

  async function apply(): Promise<void> {
    if (!preview || running) return;
    const current = generation.current;
    setError(null);
    setStarting(true);
    try {
      const next = await window.pond.query("libraryRepairs.apply", {
        token: preview.token,
      });
      if (current !== generation.current) {
        await cancelRetiredJob(next.id);
        return;
      }
      setStarting(false);
      setJob(next);
      await poll(next.id, current);
    } catch (cause) {
      if (current !== generation.current) return;
      setStarting(false);
      setError(
        errorCopy(cause, "Pond couldn't repair your library. Try again."),
      );
    }
  }

  async function poll(id: string, current: number): Promise<void> {
    while (current === generation.current) {
      const next = await window.pond.query("libraryRepairs.get", { id });
      if (current !== generation.current) return;
      if (!next)
        throw new Error(
          "This Library repair is no longer available. Close it and preview again.",
        );
      setJob(next);
      if (next.status !== "queued" && next.status !== "running") return;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 200);
      });
    }
  }

  async function close(): Promise<void> {
    const current = generation.current;
    try {
      if (running && job)
        await window.pond.query("libraryRepairs.cancel", { id: job.id });
      if (current !== generation.current) return;
      generation.current++;
      onClose();
    } catch (cause) {
      if (current === generation.current)
        setError(
          errorCopy(cause, "Pond couldn't stop this repair. Try again."),
        );
    }
  }

  const count = preview?.issues.length ?? 0;
  const progress = starting
    ? preview
      ? "Starting repair"
      : "Checking library"
    : running && job && job.total > 0
      ? `${job.processed} of ${job.total}`
      : running
        ? "Checking library"
        : null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) void close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className={styles.popup}>
          <Dialog.Header>
            <Dialog.Title>{LABELS[kind]}</Dialog.Title>
          </Dialog.Header>
          <Dialog.Description>{DESCRIPTIONS[kind]}</Dialog.Description>
          <Dialog.Content className={styles.content}>
            {progress ? <p className={styles.status}>{progress}</p> : null}
            {error || job?.error ? (
              <p className={styles.error}>{error ?? job?.error}</p>
            ) : null}
            {completed ? (
              <p className={styles.status}>
                {`Repaired ${formatPlural(job.result?.repaired ?? 0, { one: "Save", other: "Saves" })}.`}
              </p>
            ) : null}
            {preview && !completed ? (
              <>
                <p className={styles.status}>
                  {count === 0
                    ? "No repairs needed."
                    : `${formatPlural(count, { one: "Save needs", other: "Saves need" })} repair.`}
                </p>
                {count > 0 ? (
                  <>
                    <div className={styles.list}>
                      {preview.issues.map((issue) => (
                        <div className={styles.issue} key={issue.id}>
                          <strong>{issue.title || issue.saveId}</strong>
                          <span>{issue.summary}</span>
                          <small>{issue.detail}</small>
                        </div>
                      ))}
                    </div>
                    <div className={styles.confirmation}>
                      <span>Pond backs up every file it changes first.</span>
                      {preview.confirmation.movesToTrash ? (
                        <span>
                          These saves move to Trash. Their folders on disk stay
                          in place.
                        </span>
                      ) : null}
                      <span>
                        {preview.confirmation.canUndo
                          ? "You can undo this repair."
                          : "You can't undo this repair."}
                      </span>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </Dialog.Content>
          <Dialog.Footer>
            <Dialog.Cancel>{completed ? "Close" : "Cancel"}</Dialog.Cancel>
            {!completed && count > 0 ? (
              <Dialog.Confirm
                type="button"
                loading={job?.phase === "apply" && running}
                disabled={running || Boolean(error)}
                onClick={() => void apply()}
              >
                Repair
              </Dialog.Confirm>
            ) : null}
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
