import { Dialog } from "@pond/ui";
import type { QueryResult } from "@shared/query-contracts";
import { type UpdateNotice, UpdateNoticeSchema } from "@shared/update-notice";
import { useEffect, useState } from "react";
import { updateDialogCopy } from "./copy";

type UpdateAction = "updates.download" | "updates.install";
type UpdateActionResult = QueryResult<UpdateAction>;

interface UpdateNoticeSubscriptionDependencies {
  current(): Promise<UpdateNotice | null>;
  subscribe(listener: (notice: UpdateNotice) => void): () => void;
  warn(error: Error): void;
}

const defaultSubscriptionDependencies: UpdateNoticeSubscriptionDependencies = {
  current: async () => {
    const result = await window.pond.query("updates.currentNotice", {});
    return UpdateNoticeSchema.nullable().parse(result);
  },
  subscribe: (listener) => window.pond.onUpdateNotice(listener),
  warn: (error) => console.warn("[pond updater] replay failed", error),
};

const FALLBACK_ERRORS = {
  "updates.download": "Couldn't download the update. Try again.",
  "updates.install": "Couldn't restart Pond. Try again.",
} satisfies Record<UpdateAction, string>;

export function UpdateDialog() {
  const [notice, setNotice] = useState<UpdateNotice | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeToUpdateNotices((next) => {
        if (!updateDialogCopy(next)) return;
        setNotice(next);
        setBusy(false);
        setError(null);
        setOpen(true);
      }),
    [],
  );

  const copy = notice ? updateDialogCopy(notice) : null;

  async function confirm() {
    if (!notice) return;
    const action =
      notice.phase === "downloaded" ? "updates.install" : "updates.download";
    setBusy(true);
    setError(null);
    const failure = await runUpdateAction(action);
    if (!failure && action === "updates.install") return;
    setError(failure);
    setBusy(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {copy ? (
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup aria-busy={busy}>
            <Dialog.Header>
              <Dialog.Title>{copy.title}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Content>
              <Dialog.Description>{copy.description}</Dialog.Description>
              {error ? (
                <Dialog.Description role="alert" data-error>
                  {error}
                </Dialog.Description>
              ) : null}
            </Dialog.Content>
            <Dialog.Footer>
              <Dialog.Cancel>Later</Dialog.Cancel>
              <Dialog.Confirm
                disabled={busy}
                loading={busy}
                onClick={() => void confirm()}
              >
                {copy.action}
              </Dialog.Confirm>
            </Dialog.Footer>
          </Dialog.Popup>
        </Dialog.Portal>
      ) : null}
    </Dialog.Root>
  );
}

export function subscribeToUpdateNotices(
  present: (notice: UpdateNotice) => void,
  dependencies: UpdateNoticeSubscriptionDependencies = defaultSubscriptionDependencies,
): () => void {
  let active = true;
  let lastNotice = "";
  const presentOnce = (notice: UpdateNotice) => {
    const key = `${notice.phase}:${notice.version}:${"downloading" in notice ? notice.downloading : ""}`;
    if (key === lastNotice) return;
    lastNotice = key;
    present(notice);
  };
  const unsubscribe = dependencies.subscribe(presentOnce);
  void dependencies
    .current()
    .then((notice) => {
      if (active && notice) presentOnce(notice);
    })
    .catch((error) => {
      dependencies.warn(
        error instanceof Error ? error : new Error("Unknown updater error"),
      );
    });
  return () => {
    active = false;
    unsubscribe();
  };
}

/** Resolves to an error message, or null when the action succeeded. */
export async function runUpdateAction(
  name: UpdateAction,
  run: (name: UpdateAction) => Promise<UpdateActionResult> = (next) =>
    window.pond.query(next, {}),
): Promise<string | null> {
  try {
    const result = await run(name);
    if (result.ok) return null;
    return (
      result.error ??
      (result.reason === "dev_build"
        ? "Updates aren't available in development builds."
        : FALLBACK_ERRORS[name])
    );
  } catch (error) {
    return error instanceof Error ? error.message : FALLBACK_ERRORS[name];
  }
}
