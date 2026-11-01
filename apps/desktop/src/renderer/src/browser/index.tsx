import { Button } from "@pond/ui";
import type { WebSessionSchema } from "@shared/web-contracts";
import { MotionConfig } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { installBrowserAdapter } from "./adapter";
import {
  BrowserConnectionForm,
  BrowserConnectionHeader,
} from "./connection-form";
import { BrowserFixtureControls } from "./fixture-controls";
import { registerBrowserPwa } from "./pwa";
import { connectBrowser, readBrowserSession } from "./session";
import "../styles.css";
import "../app/boot-shell";
import styles from "./styles.module.css";

function BrowserConnectionStatus({
  session,
  ready,
  status,
  error,
  busy,
  onBusy,
  onStatus,
  onError,
}: {
  session: ReturnType<typeof WebSessionSchema.parse>;
  ready: boolean;
  status: string;
  error: string;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onStatus: (status: string) => void;
  onError: (error: string) => void;
}) {
  if (ready && !session.fixtures && !error && status === "Connected to Circé")
    return null;
  return (
    <section className={styles.bar} aria-label="Host connection">
      <span role="status">{status}</span>
      {ready && session.fixtures ? (
        <BrowserFixtureControls
          busy={busy}
          onBusy={onBusy}
          onStatus={onStatus}
          onError={onError}
        />
      ) : null}
      <Button
        onClick={async () => {
          try {
            const response = await fetch("/web/session", {
              method: "DELETE",
              headers: { "x-iris-library": session.libraryId },
            });
            if (!response.ok)
              throw new Error("Couldn’t disconnect. Try again.");
            location.reload();
          } catch (cause) {
            onError(
              cause instanceof Error
                ? cause.message
                : "Couldn’t disconnect. Try again.",
            );
          }
        }}
      >
        Disconnect
      </Button>
      <p id="host-error" role="alert" hidden={!error}>
        {error}
      </p>
      {error && (
        <>
          <Button onClick={() => location.reload()}>Reload</Button>
          <Button onClick={() => onError("")}>Dismiss</Button>
        </>
      )}
    </section>
  );
}

function BrowserConnection() {
  const [session, setSession] = useState<ReturnType<
    typeof WebSessionSchema.parse
  > | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Connecting to Circé…");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const connecting = useRef(false);
  useEffect(() => {
    void registerBrowserPwa();
    let active = true;
    const onError = (event: Event) => {
      if (event instanceof CustomEvent) setError(String(event.detail));
    };
    const onConnection = (event: Event) => {
      if (event instanceof CustomEvent) setStatus(String(event.detail));
    };
    window.addEventListener("iris-error", onError);
    window.addEventListener("iris-connection", onConnection);
    void readBrowserSession()
      .then((current) => {
        if (!active) return;
        if (current) setSession(current);
        else setStatus("Connect to your private library");
        setCheckingSession(false);
      })
      .catch(() => {
        if (active)
          setError(
            "Your Mac is unavailable. Check that Circé and Tailscale are running, then reload.",
          );
      });
    return () => {
      active = false;
      window.removeEventListener("iris-error", onError);
      window.removeEventListener("iris-connection", onConnection);
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    if (matchMedia("(max-width: 700px)").matches) {
      localStorage.setItem("pond.sidebar", "0");
      localStorage.setItem("pond.details", "0");
    }
    void installBrowserAdapter(session.libraryId)
      .then(() => import("../main"))
      .then(() => setReady(true))
      .catch((failure) => {
        console.error("Circé browser startup failed", failure);
        setError(
          failure instanceof Error
            ? failure.message
            : "The application could not start. Reload to retry.",
        );
      });
  }, [session]);
  if (checkingSession && !session)
    return (
      <section
        className={styles.connect}
        aria-label="Host connection"
        aria-busy={!error}
      >
        <BrowserConnectionHeader />
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button onClick={() => location.reload()}>Reload</Button>
          </>
        ) : (
          <p role="status">Connecting to your Library…</p>
        )}
      </section>
    );
  if (session)
    return (
      <BrowserConnectionStatus
        session={session}
        ready={ready}
        status={status}
        error={error}
        busy={busy}
        onBusy={setBusy}
        onStatus={setStatus}
        onError={setError}
      />
    );
  return (
    <section className={styles.connect} aria-label="Host connection">
      <BrowserConnectionHeader />
      <BrowserConnectionForm
        error={error}
        busy={busy}
        onError={setError}
        onConnect={async (input) => {
          if (connecting.current) return;
          connecting.current = true;
          setBusy(true);
          setError("");
          try {
            setSession(await connectBrowser(input));
          } catch (cause) {
            setError(
              cause instanceof Error ? cause.message : "Connection failed.",
            );
          } finally {
            connecting.current = false;
            setBusy(false);
          }
        }}
      />
    </section>
  );
}

const host = document.getElementById("browser-connection");
if (!host) throw new Error("Browser connection mount missing.");
createRoot(host).render(
  <MotionConfig reducedMotion="user">
    <BrowserConnection />
  </MotionConfig>,
);
