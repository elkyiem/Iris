import { describe, expect, it } from "vitest";
import { sourceTargetUrl } from "./source-target-url";

describe("sourceTargetUrl", () => {
  it.each([
    [
      "instagram",
      "oluwa.rafa",
      undefined,
      "https://www.instagram.com/oluwa.rafa/",
    ],
    ["twitter", "@pond", undefined, "https://x.com/pond"],
    ["threads", "pond", undefined, "https://www.threads.com/@pond"],
    ["reddit", "pond", undefined, "https://www.reddit.com/user/pond/"],
    ["tiktok", "pond", undefined, "https://www.tiktok.com/@pond"],
    [
      "pinterest",
      "pond/ideas",
      "board",
      "https://www.pinterest.com/pond/ideas/",
    ],
    ["arena", "pond/channel", "channel", "https://www.are.na/pond/channel"],
    ["cosmos", "pond/ideas", "cluster", "https://www.cosmos.so/pond/ideas"],
    ["youtube", "pond/shorts", "channel", "https://www.youtube.com/@pond"],
    [
      "youtube",
      "PL pond",
      "playlist",
      "https://www.youtube.com/playlist?list=PL%20pond",
    ],
    ["twitter", "12345", "list", "https://x.com/i/lists/12345"],
    [
      "web",
      "https://example.com/Feed?key=AbC",
      "feed",
      "https://example.com/Feed?key=AbC",
    ],
  ] as const)("builds a %s target URL", (source, handle, kind, expected) => {
    expect(sourceTargetUrl({ source, handle, kind })).toBe(expected);
  });

  it("encodes each path segment without encoding separators", () => {
    expect(
      sourceTargetUrl({
        source: "cosmos",
        handle: "pond user/visual ideas",
        kind: "cluster",
      }),
    ).toBe("https://www.cosmos.so/pond%20user/visual%20ideas");
  });

  it("returns null without a usable handle", () => {
    expect(sourceTargetUrl({ source: "instagram", handle: null })).toBeNull();
    expect(sourceTargetUrl({ source: "instagram", handle: " / " })).toBeNull();
  });

  it("preserves a feed path and query and removes its fragment", () => {
    expect(
      sourceTargetUrl({
        source: "web",
        kind: "feed",
        handle: " https://example.com/Feed?key=AbC#top ",
      }),
    ).toBe("https://example.com/Feed?key=AbC");
  });

  it.each(["file:///tmp/feed", "https://user:pass@example.com/feed"])(
    "does not open an invalid feed address %s",
    (handle) => {
      expect(
        sourceTargetUrl({ source: "web", kind: "feed", handle }),
      ).toBeNull();
    },
  );
});
