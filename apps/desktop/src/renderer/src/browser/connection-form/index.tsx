import { Button, Checkbox, Field, Input, OTPField, Reveal } from "@pond/ui";
import type { BrowserConnectionInput } from "@shared/web-connections-contracts";
import { useRef, useState } from "react";
import appIcon from "../../generated/app-icon-previews/aqua.png";
import styles from "./styles.module.css";

function browserLabel() {
  const platform = navigator.platform;
  if (/Win/i.test(platform)) return "Windows browser";
  if (
    /iPad|iPhone/i.test(navigator.userAgent) ||
    (/Mac/i.test(platform) && navigator.maxTouchPoints > 1)
  )
    return "iPhone or iPad browser";
  if (/Mac/i.test(platform)) return "Mac browser";
  if (/Android/i.test(navigator.userAgent)) return "Android browser";
  return "Browser";
}

export function BrowserConnectionHeader() {
  return (
    <header className={styles.header}>
      <img src={appIcon} width="56" height="56" alt="" />
      <div className={styles.heading}>
        <h1>Connect to Circé</h1>
        <p>Your Library, on this device.</p>
      </div>
    </header>
  );
}

export function BrowserConnectionForm({
  busy,
  error,
  onConnect,
  onError,
}: {
  busy: boolean;
  error: string;
  onConnect(input: BrowserConnectionInput): Promise<void>;
  onError(message: string): void;
}) {
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [useKey, setUseKey] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const options = { remember, label: browserLabel() };
  return (
    <form
      className={styles.form}
      data-browser-connection
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        if (useKey) {
          const key = new FormData(event.currentTarget).get("key");
          if (key instanceof File || key === null) return;
          await onConnect({ method: "key", key, ...options });
        } else await onConnect({ method: "code", code, ...options });
      }}
    >
      <Field.Root invalid={Boolean(error)} className={styles.field}>
        {useKey ? (
          <>
            <Field.Label htmlFor="host-key">Access key</Field.Label>
            <Field.Description>
              Use the key saved on your Mac, or choose a key file copied to this
              device.
            </Field.Description>
            <Input.Root size="lg">
              <Input.Field
                id="host-key"
                name="key"
                type="password"
                autoComplete="current-password"
                disabled={busy}
                required
                aria-describedby="host-error"
              />
            </Input.Root>
          </>
        ) : (
          <>
            <Field.Label htmlFor="pairing-code">Connection code</Field.Label>
            <Field.Description>
              On a connected device, open Settings → Library → Connected
              browsers to get a code.
            </Field.Description>
            <OTPField.Root
              id="pairing-code"
              name="code"
              length={6}
              value={code}
              onValueChange={(value) => {
                setCode(value);
                if (error) onError("");
              }}
              disabled={busy}
              required
              aria-describedby="host-error"
            >
              {[1, 2, 3, 4, 5, 6].map((digit) => (
                <OTPField.Input
                  key={digit}
                  aria-label={digit === 1 ? undefined : `Digit ${digit} of 6`}
                />
              ))}
            </OTPField.Root>
          </>
        )}
        <Reveal visible={Boolean(error)} initial={false}>
          <Field.Error id="host-error" match role="alert">
            {error}
          </Field.Error>
        </Reveal>
      </Field.Root>
      <label className={styles.remember} htmlFor="remember-browser">
        <Checkbox.Root
          id="remember-browser"
          aria-labelledby="remember-browser-label"
          aria-describedby="remember-browser-description"
          checked={remember}
          onCheckedChange={setRemember}
          disabled={busy}
        >
          <Checkbox.Indicator />
        </Checkbox.Root>
        <span>
          <span id="remember-browser-label">Remember this browser</span>
          <span id="remember-browser-description" className={styles.detail}>
            Stay connected for 90 days.
          </span>
        </span>
      </label>
      <Button
        type="submit"
        width="full"
        size="lg"
        loading={busy}
        disabled={!useKey && code.length !== 6}
      >
        Connect
      </Button>
      <input
        ref={picker}
        id="host-key-file"
        aria-label="Access key file"
        type="file"
        hidden
        disabled={busy}
        onChange={async (event) => {
          if (busy) return;
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          if (file.size > 256) {
            onError("Choose the access key file copied from your Mac.");
            return;
          }
          try {
            await onConnect({
              method: "key",
              key: (await file.text()).trim(),
              ...options,
            });
          } catch {
            onError("Couldn’t read the access key file. Try again.");
          }
        }}
      />
      <Reveal visible={useKey} initial={false}>
        <Button
          type="button"
          variant="secondary"
          width="full"
          aria-label="Choose key file"
          disabled={busy}
          onClick={() => picker.current?.click()}
        >
          Choose key file
        </Button>
      </Reveal>
      <Button
        type="button"
        variant="link"
        id="connection-method"
        disabled={busy}
        onClick={() => {
          setUseKey(!useKey);
          onError("");
        }}
      >
        {useKey ? "Use a connection code" : "Use an access key instead"}
      </Button>
    </form>
  );
}
