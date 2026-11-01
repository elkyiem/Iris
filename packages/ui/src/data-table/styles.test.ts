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
const headerCss = read("header/styles.module.css");

function declarations(source: string, selector: string) {
  const start = source.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("}", start)).replace(/\s+/g, " ");
}

describe("data table overflow", () => {
  it("scrolls the sticky header with the rows", () => {
    const viewport = declarations(css, ".viewport");
    expect(viewport).toContain("overflow: auto;");
    const header = declarations(headerCss, ".scroll");
    expect(header).toContain("position: sticky;");
    expect(header).toContain("top: 0;");
    expect(declarations(css, ".body")).not.toContain("overflow");
  });

  it("lets the header and row backgrounds grow from their shared minimum", () => {
    for (const rule of [
      declarations(headerCss, ".row"),
      declarations(css, ".row"),
    ]) {
      expect(rule).toContain("width: 100%;");
      expect(rule).not.toContain("min-width: 0;");
    }
    expect(declarations(css, ".sheet")).toContain("width: 100%;");
  });
});
