import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserConnectionForm } from ".";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function renderForm(
  props: Partial<ComponentProps<typeof BrowserConnectionForm>> = {},
) {
  const callbacks = { onConnect: vi.fn(async () => {}), onError: vi.fn() };
  await act(async () => {
    root.render(
      <BrowserConnectionForm busy={false} error="" {...callbacks} {...props} />,
    );
  });
  return callbacks;
}

function input(selector: string) {
  const element = host.querySelector<HTMLInputElement>(selector);
  if (!element) throw new Error(`Missing input ${selector}`);
  return element;
}

function button(text: string) {
  const element = Array.from(host.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === text,
  );
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
}

async function click(text: string) {
  await act(async () => button(text).click());
}

async function pasteCode(text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (format: string) => (format === "text/plain" ? text : ""),
    },
  });
  await act(async () => {
    input("#pairing-code").focus();
    input("#pairing-code").dispatchEvent(event);
  });
}

async function enterKey(value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("Missing native input value setter");
  await act(async () => {
    setter.call(input("#host-key"), value);
    input("#host-key").dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("requires a complete six digit code and connects with leading zeroes and remember enabled", async () => {
  const { onConnect } = await renderForm();
  expect(input("#pairing-code").labels?.[0]?.textContent).toBe(
    "Connection code",
  );
  expect(
    host.querySelectorAll('input[type="text"]:not([aria-hidden="true"])'),
  ).toHaveLength(6);
  expect(
    host.querySelector('[role="checkbox"]')?.getAttribute("aria-checked"),
  ).toBe("true");
  expect(button("Connect").disabled).toBe(true);
  await pasteCode("00123");
  expect(button("Connect").disabled).toBe(true);
  await click("Connect");
  expect(onConnect).not.toHaveBeenCalled();
  await pasteCode("001234");
  expect(button("Connect").disabled).toBe(false);
  await click("Connect");
  expect(onConnect).toHaveBeenCalledExactlyOnceWith({
    method: "code",
    code: "001234",
    remember: true,
    label: "Mac browser",
  });
});

it("gives the remember checkbox a concise accessible name and separate explanatory text", async () => {
  await renderForm();
  const checkbox = host.querySelector('[role="checkbox"]');
  if (!checkbox) throw new Error("Missing remember checkbox");
  const labelledBy = checkbox.getAttribute("aria-labelledby");
  const name = labelledBy
    ? labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent)
        .join(" ")
    : checkbox.getAttribute("aria-label");
  expect(name?.replace(/\s+/g, " ").trim()).toBe("Remember this browser");
  const describedBy = checkbox.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  expect(
    describedBy ? document.getElementById(describedBy)?.textContent : null,
  ).toBe("Stay connected for 90 days.");
});

it("offers an explicitly labelled access key fallback and respects the remember choice", async () => {
  const { onConnect, onError } = await renderForm();
  await click("Use an access key instead");
  expect(onError).toHaveBeenCalledWith("");
  expect(input("#host-key").labels?.[0]?.textContent).toBe("Access key");
  expect(input("#host-key").type).toBe("password");
  expect(input("#host-key-file").hidden).toBe(true);
  expect(button("Choose key file").getAttribute("aria-label")).toBe(
    "Choose key file",
  );
  const checkbox = host.querySelector<HTMLButtonElement>('[role="checkbox"]');
  if (!checkbox) throw new Error("Missing remember checkbox");
  await act(async () => checkbox.click());
  await enterKey("saved-access-key");
  await click("Connect");
  expect(onConnect).toHaveBeenCalledExactlyOnceWith({
    method: "key",
    key: "saved-access-key",
    remember: false,
    label: "Mac browser",
  });
});

it("preserves the entered code when switching methods and clears a displayed error on editing", async () => {
  const onError = vi.fn();
  await renderForm({ error: "That code has expired.", onError });
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "That code has expired.",
  );
  expect(input("#pairing-code").getAttribute("aria-invalid")).toBe("true");
  await pasteCode("001234");
  expect(onError).toHaveBeenCalledWith("");
  await click("Use an access key instead");
  await click("Use a connection code");
  expect(input('input[name="code"]').value).toBe("001234");
  expect(button("Connect").disabled).toBe(false);
});

it("disables connection controls while busy and ignores a second form submission", async () => {
  const onConnect = vi.fn(async () => {});
  await renderForm({ onConnect });
  await pasteCode("001234");
  await click("Connect");
  await renderForm({ onConnect, busy: true });
  expect(button("Connect").disabled).toBe(true);
  expect(button("Connect").getAttribute("aria-busy")).toBe("true");
  expect(button("Use an access key instead").disabled).toBe(true);
  expect(input("#pairing-code").disabled).toBe(true);
  const checkbox = host.querySelector<HTMLButtonElement>('[role="checkbox"]');
  expect(checkbox?.getAttribute("aria-disabled")).toBe("true");
  expect(input('input[type="checkbox"]').disabled).toBe(true);
  await click("Connect");
  const form = host.querySelector("form");
  if (!form) throw new Error("Missing connection form");
  await act(async () => form.requestSubmit());
  expect(onConnect).toHaveBeenCalledTimes(1);
});

it("rejects oversized key files before attempting a connection", async () => {
  const { onConnect, onError } = await renderForm();
  await click("Use an access key instead");
  const fileInput = input("#host-key-file");
  Object.defineProperty(fileInput, "files", {
    value: [new File(["a".repeat(257)], "access-key.txt")],
  });
  await act(async () =>
    fileInput.dispatchEvent(new Event("change", { bubbles: true })),
  );
  expect(onError).toHaveBeenLastCalledWith(
    "Choose the access key file copied from your Mac.",
  );
  expect(onConnect).not.toHaveBeenCalled();
});
