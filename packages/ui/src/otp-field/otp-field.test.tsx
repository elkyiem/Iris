/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OTPField } from ".";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function slot(index: number) {
  const input = host.querySelectorAll<HTMLInputElement>(
    'input[type="text"]:not([aria-hidden="true"])',
  )[index];
  if (!input) throw new Error(`Missing OTP slot ${index}`);
  return input;
}

async function paste(input: HTMLInputElement, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (format: string) => (format === "text/plain" ? text : ""),
    },
  });
  await act(async () => {
    input.focus();
    input.dispatchEvent(event);
  });
}

async function press(input: HTMLInputElement, key: string) {
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

async function renderField(props: {
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  onKeyDown?: () => void;
}) {
  await act(async () => {
    root.render(
      <>
        <label htmlFor="connection-code">Connection code</label>
        <OTPField.Root
          id="connection-code"
          name="code"
          length={6}
          disabled={props.disabled}
          onValueChange={props.onValueChange}
        >
          {[1, 2, 3, 4, 5, 6].map((digit) => (
            <OTPField.Input
              key={digit}
              aria-label={digit === 1 ? undefined : `Digit ${digit} of 6`}
              onKeyDown={props.onKeyDown}
            />
          ))}
        </OTPField.Root>
      </>,
    );
  });
}

it("labels all six slots and preserves leading zeroes when a complete code is pasted", async () => {
  const onValueChange = vi.fn();
  await renderField({ onValueChange });
  expect(slot(0).labels?.[0]?.textContent).toBe("Connection code");
  expect(slot(0).autocomplete).toBe("one-time-code");
  expect(slot(0).tabIndex).toBe(0);
  expect(slot(1).tabIndex).toBe(-1);
  for (let index = 1; index < 6; index++) {
    expect(slot(index).getAttribute("aria-label")).toBe(
      `Digit ${index + 1} of 6`,
    );
  }
  await paste(slot(0), "001234");
  expect(
    Array.from(
      host.querySelectorAll<HTMLInputElement>(
        'input[type="text"]:not([aria-hidden="true"])',
      ),
      (input) => input.value,
    ).join(""),
  ).toBe("001234");
  expect(onValueChange.mock.calls[0]?.[0]).toBe("001234");
  expect(
    host.querySelector<HTMLInputElement>('input[name="code"]')?.value,
  ).toBe("001234");
  expect(document.activeElement).toBe(slot(5));
});

it("advances focus as digits are typed and keeps the complete value as a string", async () => {
  const onValueChange = vi.fn();
  await renderField({ onValueChange });
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("Missing native input value setter");
  await act(async () => slot(0).focus());
  for (const [index, digit] of Array.from("001234").entries()) {
    await press(slot(index), digit);
    await act(async () => {
      setter.call(slot(index), digit);
      slot(index).dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: digit,
          inputType: "insertText",
        }),
      );
    });
    expect(document.activeElement).toBe(slot(Math.min(index + 1, 5)));
  }
  expect(onValueChange.mock.lastCall?.[0]).toBe("001234");
  expect(
    host.querySelector<HTMLInputElement>('input[name="code"]')?.value,
  ).toBe("001234");
});

it("moves between slots and edits a pasted code using keyboard commands", async () => {
  await renderField({});
  await paste(slot(0), "012345");
  await press(slot(5), "ArrowLeft");
  expect(document.activeElement).toBe(slot(4));
  await press(slot(4), "Home");
  expect(document.activeElement).toBe(slot(0));
  await press(slot(0), "End");
  expect(document.activeElement).toBe(slot(5));
  await press(slot(5), "Backspace");
  expect(slot(5).value).toBe("");
  expect(document.activeElement).toBe(slot(4));
  await press(slot(4), "Delete");
  expect(slot(4).value).toBe("");
  expect(
    host.querySelector<HTMLInputElement>('input[name="code"]')?.value,
  ).toBe("0123");
});

it("keeps typing shortcuts local while forwarding Escape and modified shortcuts", async () => {
  const onKeyDown = vi.fn();
  const pageKeys: string[] = [];
  const record = (event: KeyboardEvent) => pageKeys.push(event.key);
  document.addEventListener("keydown", record);
  try {
    await renderField({ onKeyDown });
    await press(slot(0), "k");
    await press(slot(0), "Escape");
    await act(async () => {
      slot(0).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
        }),
      );
    });
    expect(onKeyDown).toHaveBeenCalledTimes(3);
    expect(pageKeys).toEqual(["Escape", "k"]);
  } finally {
    document.removeEventListener("keydown", record);
  }
});

it("does not change a disabled field through paste or keyboard editing", async () => {
  const onValueChange = vi.fn();
  await renderField({ disabled: true, onValueChange });
  expect(
    Array.from(
      host.querySelectorAll<HTMLInputElement>(
        'input[type="text"]:not([aria-hidden="true"])',
      ),
    ).every((input) => input.disabled),
  ).toBe(true);
  await paste(slot(0), "123456");
  await press(slot(0), "Backspace");
  expect(onValueChange).not.toHaveBeenCalled();
  expect(slot(0).value).toBe("");
});
