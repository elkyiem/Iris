import { Button, Settings } from "@pond/ui";
import { useState } from "react";
import { z } from "zod";
import { loadAppInfo } from "@/shared/lib/app-info";
import { isBrowserRuntime } from "@/shared/lib/platform";
import { whatsNewDialog } from "@/shared/state/whats-new";

const UpdateCheckSchema = z.object({
  ok: z.boolean(),
  version: z.string().optional(),
  reason: z.string().optional(),
  error: z.string().optional(),
});

export function CheckNowRow() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function checkNow() {
    setBusy(true);
    setMessage(null);
    try {
      const [info, raw] = await Promise.all([
        loadAppInfo(),
        window.pond.query("updates.checkNow", {}),
      ]);
      const result = UpdateCheckSchema.parse(raw);
      if (!result.ok) {
        setMessage(
          result.reason === "dev_build"
            ? isBrowserRuntime()
              ? "This host runs from source. Updates are applied when the Circé host is rebuilt."
              : "Updates are only available in packaged builds."
            : (result.error ?? "Could not check for updates."),
        );
        return;
      }
      if (!result.version || result.version === info.version) {
        setMessage(`You're on the latest version (${info.version}).`);
        return;
      }
      setMessage(`Pond ${result.version} is available.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Settings.ItemDetails>
        <Settings.ItemTitle>Check for Updates</Settings.ItemTitle>
        <Settings.ItemDescription>
          {isBrowserRuntime()
            ? "Look for a newer build for your host computer."
            : "Look for a newer build."}
          {message ? (
            <>
              <br />
              <span>{message}</span>
            </>
          ) : null}
        </Settings.ItemDescription>
      </Settings.ItemDetails>
      <Settings.ItemControl>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void checkNow()}
          disabled={busy}
          loading={busy}
        >
          Check Now
        </Button>
      </Settings.ItemControl>
    </>
  );
}

export function WhatsNewRow() {
  return (
    <>
      <Settings.ItemDetails>
        <Settings.ItemTitle>What's New</Settings.ItemTitle>
        <Settings.ItemDescription>
          Read the release notes for every version of Pond.
        </Settings.ItemDescription>
      </Settings.ItemDetails>
      <Settings.ItemControl>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => whatsNewDialog.open()}
        >
          Open
        </Button>
      </Settings.ItemControl>
    </>
  );
}
