import { describe, expect, it } from "vitest";
import { formatNumber, formatPlural } from "./format";

const saves = { one: "save", other: "saves" };

describe("formatPlural", () => {
  it("uses the singular noun for one", () => {
    expect(formatPlural(1, saves)).toBe("1 save");
  });

  it("uses the plural noun for zero and many", () => {
    expect(formatPlural(0, saves)).toBe("0 saves");
    expect(formatPlural(2, saves)).toBe("2 saves");
  });

  it("groups large counts with the number formatter", () => {
    expect(formatPlural(1234, saves)).toBe(`${formatNumber(1234)} saves`);
  });
});
