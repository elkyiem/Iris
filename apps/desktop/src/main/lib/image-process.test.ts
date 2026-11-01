import { expect, it } from "vitest";
import { probeImageDims } from "./image-process";

const PAYLOAD_BYTES = 64;

function ico(
  sizes: Array<[width: number, height: number]>,
  declaredSize = PAYLOAD_BYTES,
): Buffer {
  const header = Buffer.from([0x00, 0x00, 0x01, 0x00, sizes.length, 0x00]);
  const payloadStart = header.length + sizes.length * 16;
  const entries = sizes.map(([width, height], i) => {
    const entry = Buffer.alloc(16);
    entry[0] = width;
    entry[1] = height;
    entry.writeUInt32LE(declaredSize, 8);
    entry.writeUInt32LE(payloadStart + i * PAYLOAD_BYTES, 12);
    return entry;
  });
  /* BMP payloads, as most favicons carry; sharp cannot decode them. */
  const payloads = Buffer.alloc(sizes.length * PAYLOAD_BYTES);
  return Buffer.concat([header, ...entries, payloads]);
}

it("reads the size of a BMP favicon that sharp cannot decode", async () => {
  expect(await probeImageDims(ico([[16, 16]]))).toEqual({
    width: 16,
    height: 16,
  });
});

it("picks the largest icon and reads a size of 0 as 256", async () => {
  expect(
    await probeImageDims(
      ico([
        [32, 32],
        [0, 0],
      ]),
    ),
  ).toEqual({ width: 256, height: 256 });
});

it("rejects an ICO whose entry points past the end", async () => {
  await expect(
    probeImageDims(ico([[16, 16]], PAYLOAD_BYTES + 1)),
  ).rejects.toThrow();
});

it("rejects an ICO whose directory is cut off", async () => {
  await expect(
    probeImageDims(ico([[16, 16]]).subarray(0, 12)),
  ).rejects.toThrow();
});

it("still rejects bytes that are not an image", async () => {
  await expect(
    probeImageDims(Buffer.from("<!doctype html><html>")),
  ).rejects.toThrow();
});
