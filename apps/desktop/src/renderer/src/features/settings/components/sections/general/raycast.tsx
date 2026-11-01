import { Button, Dialog, Settings, Tooltip } from "@pond/ui";
import { useState } from "react";
import { errorCopy } from "@/shared/lib/error-copy";
import { isBrowserRuntime } from "@/shared/lib/platform";

export function RaycastRow() {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyToken() {
    setBusy(true);
    setCopied(false);
    setError(null);
    try {
      const { token } = await window.pond.query("settings.ingestToken", {});
      if (!token)
        throw new Error("Couldn't read the Local API Token. Try again.");
      const result = await window.pond.query("clipboard.writeText", {
        text: token,
      });
      if (!result.ok) throw new Error("Couldn't copy the token. Try again.");
      setCopied(true);
    } catch (reason) {
      setError(errorCopy(reason, "Couldn't copy the token. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function rotateToken() {
    setBusy(true);
    setCopied(false);
    setError(null);
    try {
      const { token } = await window.pond.query(
        "settings.rotateIngestToken",
        {},
      );
      const result = await window.pond.query("clipboard.writeText", {
        text: token,
      });
      if (!result.ok)
        throw new Error("Couldn't copy the new token. Try again.");
      setCopied(true);
    } catch (reason) {
      setError(errorCopy(reason, "Couldn't rotate the token. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Settings.ItemDetails>
        <Settings.ItemTitle>
          {isBrowserRuntime() ? "Raycast on Your Mac Host" : "Raycast"}
          <Tooltip.Info
            label="It connects the Raycast extension to Pond's local API."
            aria-label="About Raycast"
          />
        </Settings.ItemTitle>
        <Settings.ItemDescription>
          {isBrowserRuntime()
            ? "Use this host-wide local API token with Raycast on your Mac. Copy its Base URL from Local API settings. Treat the token like a password."
            : "Treat the token like a password."}
          {error ? (
            <>
              <br />
              <span role="alert">{error}</span>
            </>
          ) : null}
        </Settings.ItemDescription>
      </Settings.ItemDetails>
      <Settings.ItemControl>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          loading={busy}
          onClick={() => void copyToken()}
        >
          {copied ? "Copied" : "Copy Token"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            Dialog.confirm({
              title: "Rotate Local API Token",
              description: isBrowserRuntime()
                ? "Existing local integrations on your Mac host stop working until you give them the new token."
                : "Existing local integrations stop working until you give them the new token.",
              confirmLabel: "Rotate",
              onConfirm: rotateToken,
            })
          }
        >
          Rotate Token
        </Button>
      </Settings.ItemControl>
    </>
  );
}
