import { describe, expect, it } from "vitest";
import { readResponseBodyWithinBudget } from "./response-body";

describe("readResponseBodyWithinBudget", () => {
  it("keeps complete media larger than the ordinary response-body limit", async () => {
    const body = new Uint8Array(31 * 1024 * 1024);
    body[body.length - 1] = 7;
    const response = new Response(body, {
      headers: { "content-length": String(body.byteLength) },
    });

    const captured = await readResponseBodyWithinBudget(
      response,
      250 * 1024 * 1024,
    );

    expect(captured?.byteLength).toBe(body.byteLength);
    expect(captured?.at(-1)).toBe(7);
  });

  it("stops an unknown-length response when it exhausts the archive budget", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(6));
          controller.enqueue(new Uint8Array(6));
          controller.close();
        },
      }),
    );

    await expect(
      readResponseBodyWithinBudget(response, 10),
    ).resolves.toBeNull();
  });
});
