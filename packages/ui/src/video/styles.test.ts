import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), path),
    "utf8",
  );
}

const css = read("styles.module.css");
const scrubberCss = read("scrubber/styles.module.css");
const speedCss = read("speed-select/styles.module.css");

describe("video chrome", () => {
  it("centers the preview guide beneath the tooltip", () => {
    const guide = scrubberCss.match(/\.preview-line\s*\{(?<rules>[^}]*)\}/)
      ?.groups?.rules;
    expect(guide).toContain("left: 50%");
    expect(guide).toContain("transform: translateX(-50%)");
  });

  it("sizes chrome buttons to match the speed control", () => {
    const chromeButton = [
      ...css.matchAll(
        /\.controls\[data-chrome\] \.button\s*\{(?<rules>[^}]*)\}/g,
      ),
    ]
      .map((match) => match.groups?.rules)
      .join("\n");
    const chromeSpeed = speedCss.match(
      /\.root\[data-chrome\]\s*\{(?<rules>[^}]*)\}/,
    )?.groups?.rules;
    expect(chromeButton).toContain("width: var(--ds-size-sm)");
    expect(chromeButton).toContain("height: var(--ds-size-sm)");
    expect(chromeSpeed).toContain("width: var(--ds-size-sm)");
    expect(chromeSpeed).toContain("height: var(--ds-size-sm)");
    expect(chromeSpeed).toContain("padding: 0");
  });
});
