import { createHash, randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  createWebSessions,
  readPrivateWebState,
  type SavedWebSession,
} from "./auth";

const StoredSessions = z.strictObject({
  keyHash: z.string().regex(/^[a-f0-9]{64}$/),
  sessions: z
    .array(
      z.strictObject({
        idHash: z.string().regex(/^[a-f0-9]{64}$/),
        expiry: z.number().int().nonnegative(),
        scope: z.string().max(2000),
        deviceId: z.string().uuid().optional(),
        label: z.string().max(80).optional(),
        createdAt: z.number().nonnegative().optional(),
        lastUsedAt: z.number().nonnegative().optional(),
        remembered: z.boolean().optional(),
      }),
    )
    .max(100),
});

/** Only cookie hashes reach disk; the key, raw cookies and Library data never do. */
export async function openStoredWebSessions(options: {
  path: string;
  key: string;
  now?: () => number;
  warn(cause: unknown): void;
}) {
  const keyHash = createHash("sha256").update(options.key).digest("hex");
  let restored: SavedWebSession[] = [];
  try {
    const saved = StoredSessions.parse(
      JSON.parse(await readPrivateWebState(options.path, 256 * 1024)),
    );
    if (saved.keyHash === keyHash) restored = saved.sessions;
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT"))
      options.warn(cause);
  }
  return createWebSessions(options.key, options.now, {
    restored,
    warn: options.warn,
    async persist(sessions) {
      const temporary = join(
        dirname(options.path),
        `.circe-sessions-${randomUUID()}.tmp`,
      );
      try {
        await writeFile(temporary, JSON.stringify({ keyHash, sessions }), {
          flag: "wx",
          mode: 0o600,
        });
        await rename(temporary, options.path);
      } finally {
        await rm(temporary, { force: true });
      }
    },
  });
}
