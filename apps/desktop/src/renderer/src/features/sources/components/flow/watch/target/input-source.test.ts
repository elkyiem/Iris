import { expect, it } from "vitest";
import { watchInputSource } from "./input-source";

it.each([
  ["https://www.are.na/person/channel", "arena"],
  ["youtube.com/playlist?list=PL123", "youtube"],
  ["https://m.youtube.com/@person", "youtube"],
  ["https://x.com/person", "twitter"],
  ["instagram.com/person", "instagram"],
  ["https://pinterest.com/person/board", "pinterest"],
  ["https://www.cosmos.so/person/cluster", "cosmos"],
  ["https://tiktok.com/@person", "tiktok"],
])("infers the platform from %s", (input, source) => {
  expect(watchInputSource(input)).toEqual({ type: "link", source });
});

it.each(["@person", "person.name", "person/board", ""])(
  "asks for a platform for %s",
  (input) => expect(watchInputSource(input)).toEqual({ type: "handle" }),
);

it.each([
  "https://example.com/person",
  "https://instagram.com.evil.test/person",
])("rejects an unsupported link %s", (input) =>
  expect(watchInputSource(input)).toEqual({ type: "unsupported" }),
);

it("accepts a feed URL on a host without a source adapter", () => {
  expect(watchInputSource("https://example.com/Feed?key=AbC", "web")).toEqual({
    type: "link",
    source: "web",
  });
});

it.each([
  "example.com/feed",
  "file:///tmp/feed",
  "https://user:pass@example.com/feed",
])("rejects an invalid feed address %s", (input) => {
  expect(watchInputSource(input, "web")).toEqual({ type: "unsupported" });
});
