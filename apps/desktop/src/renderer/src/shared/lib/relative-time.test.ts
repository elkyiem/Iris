import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { relativeTime, relativeTimeFromMs } from "./relative-time";

const NOW = Date.parse("2026-10-31T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

it("counts seconds under a minute", () => {
  expect(relativeTimeFromMs(NOW - 12_000)).toBe("12 seconds ago");
  expect(relativeTimeFromMs(NOW)).toBe("1 second ago");
});

it("counts minutes and hours", () => {
  expect(relativeTime(new Date(NOW - 3 * 60_000).toISOString())).toBe(
    "3 minutes ago",
  );
  expect(relativeTimeFromMs(NOW - 2 * 3_600_000)).toBe("2 hours ago");
});
