import { Button, Dialog, Input, Reveal, Settings } from "@pond/ui";
import type { QueryResult } from "@shared/query-contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { isBrowserRuntime } from "@/shared/lib/platform";
import styles from "./styles.module.css";

type Code = QueryResult<"webConnections.createCode">;

export function BrowserConnections() {
  const client = useQueryClient();
  const { data, error: loadError } = useQuery({
    queryKey: ["web-connections"],
    queryFn: () => window.pond.query("webConnections.list"),
    refetchInterval: (query) => (query.state.data?.available ? 5000 : false),
  });
  const [code, setCode] = useState<Code | null>(null);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [code]);
  if (!data?.available) return null;
  const remaining = code
    ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000))
    : 0;
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["web-connections"] });
  async function createCode() {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const next = await window.pond.query("webConnections.createCode");
      setNow(Date.now());
      setCode(next);
    } catch {
      setError(
        "Couldn’t create a code. Check that Circé is connected and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function closeCode() {
    if (!code || busy) return;
    setBusy(true);
    setError("");
    try {
      await window.pond.query("webConnections.cancelCode", { id: code.id });
      setCode(null);
      await refresh();
    } catch {
      setError(
        "Couldn’t cancel this code. It will expire automatically in two minutes.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function copyCode() {
    if (!code) return;
    try {
      const result = await window.pond.query("clipboard.writeText", {
        text: code.code,
      });
      if (!result.ok) throw new Error("Clipboard unavailable");
      setCopied(true);
    } catch {
      setError("Couldn’t copy the code. Select it and copy it instead.");
    }
  }
  return (
    <Settings.List>
      <Settings.Item>
        <Settings.ItemDetails>
          <Settings.ItemTitle>Connected browsers</Settings.ItemTitle>
          <Settings.ItemDescription>
            Connect another device to this Library. You can disconnect each
            browser here.
          </Settings.ItemDescription>
        </Settings.ItemDetails>
        <Settings.ItemControl>
          <Button
            size="sm"
            variant="secondary"
            loading={busy && !code}
            onClick={() => void createCode()}
          >
            Connect a device
          </Button>
        </Settings.ItemControl>
      </Settings.Item>
      <Reveal visible={Boolean(error || loadError)} initial={false}>
        <p className={styles.error} role="alert">
          {error || "Couldn’t refresh connected browsers. Try again shortly."}
        </p>
      </Reveal>
      {data.devices.map((device) => {
        const label = data.devices.some(
          (other) => other.id !== device.id && other.label === device.label,
        )
          ? `${device.label} · ${device.id.slice(0, 6)}`
          : device.label;
        return (
          <Settings.Item key={device.id}>
            <Settings.ItemDetails>
              <Settings.ItemTitle>
                {label}
                {device.id === data.currentId ? " · This browser" : ""}
              </Settings.ItemTitle>
              <Settings.ItemDescription>
                Last used {new Date(device.lastUsedAt).toLocaleDateString()}.
                Connected until{" "}
                {new Date(device.expiresAt).toLocaleDateString()}.
              </Settings.ItemDescription>
            </Settings.ItemDetails>
            <Settings.ItemControl>
              <Button
                size="sm"
                variant="ghost"
                data-connection-id={device.id}
                aria-label={
                  device.id === data.currentId
                    ? `Forget this browser (${label})`
                    : `Disconnect ${label}`
                }
                onClick={() =>
                  Dialog.confirm({
                    title:
                      device.id === data.currentId
                        ? "Forget This Browser"
                        : "Disconnect Browser",
                    description: `${label} will need a new connection code to open this Library again.`,
                    confirmLabel: "Disconnect",
                    confirmVariant: "destructive",
                    onConfirm: async () => {
                      await window.pond.query("webConnections.revoke", {
                        id: device.id,
                      });
                      if (device.id === data.currentId && isBrowserRuntime())
                        location.reload();
                      else await refresh();
                    },
                  })
                }
              >
                {device.id === data.currentId
                  ? "Forget this browser"
                  : "Disconnect"}
              </Button>
            </Settings.ItemControl>
          </Settings.Item>
        );
      })}
      {code && (
        <Dialog.Root
          open
          onOpenChange={(open, details) => {
            if (busy) details.cancel();
            else if (!open) {
              details.cancel();
              void closeCode();
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Backdrop />
            <Dialog.Popup>
              <Dialog.Header>
                <Dialog.Title>Connect a Device</Dialog.Title>
                <Dialog.Close disabled={busy} />
              </Dialog.Header>
              <Dialog.Content className={styles.content}>
                <Dialog.Description>
                  Open{" "}
                  <a href={code.origin} target="_blank" rel="noreferrer">
                    {code.origin}
                  </a>{" "}
                  on your other device and enter this code.
                </Dialog.Description>
                <Input.Root size="xl">
                  <Input.Field
                    className={styles.code}
                    aria-label="Connection code"
                    readOnly
                    value={`${code.code.slice(0, 3)} ${code.code.slice(3)}`}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </Input.Root>
                <p
                  className={styles.expiry}
                  role={remaining === 0 ? "status" : undefined}
                >
                  {remaining > 0
                    ? `Valid for ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}. Works once.`
                    : "This code has expired. Generate a new code to continue."}
                </p>
                <Reveal visible={Boolean(error)} initial={false}>
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                </Reveal>
              </Dialog.Content>
              <Dialog.Footer>
                <Button
                  variant="secondary"
                  disabled={busy || remaining === 0}
                  onClick={() => void copyCode()}
                >
                  {copied ? "Copied" : "Copy code"}
                </Button>
                <Button loading={busy} onClick={() => void createCode()}>
                  Generate new code
                </Button>
              </Dialog.Footer>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </Settings.List>
  );
}
