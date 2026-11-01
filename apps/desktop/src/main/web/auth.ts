import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserLoginOptions } from "../../shared/web-connections-contracts";

export const WEB_SESSION_SECONDS = 12 * 60 * 60;
export const REMEMBERED_BROWSER_SECONDS = 90 * 24 * 60 * 60;

export async function readPrivateWebState(path: string, maxBytes: number) {
  const file = await lstat(path);
  if (
    !file.isFile() ||
    file.isSymbolicLink() ||
    file.size > maxBytes ||
    (process.platform !== "win32" &&
      ((file.mode & 0o077) !== 0 || file.uid !== process.getuid?.()))
  )
    throw new Error(
      "Private browser state must be a private file owned by this user.",
    );
  return readFile(path, "utf8");
}

export async function webAccessKey(sandbox: string): Promise<string> {
  const path = join(sandbox, "web-access-key");
  try {
    return (await readPrivateWebState(path, 256)).trim();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
    const key = randomBytes(32).toString("base64url");
    await writeFile(path, key, { mode: 0o600, flag: "wx" });
    return key;
  }
}

export interface SavedWebSession {
  idHash: string;
  expiry: number;
  scope: string;
  deviceId?: string;
  label?: string;
  createdAt?: number;
  lastUsedAt?: number;
  remembered?: boolean;
}
export function createWebSessions(
  key: string,
  now: () => number = Date.now,
  storage?: {
    restored: SavedWebSession[];
    persist(rows: SavedWebSession[]): Promise<void>;
    warn(cause: unknown): void;
  },
) {
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const sessions = new Map<
    string,
    {
      expiry: number;
      scope: string;
      deviceId: string;
      label: string;
      createdAt: number;
      lastUsedAt: number;
      remembered: boolean;
      listeners: Set<() => void>;
    }
  >();
  for (const row of storage?.restored ?? [])
    if (row.expiry > now())
      sessions.set(row.idHash, {
        expiry: row.expiry,
        scope: row.scope,
        deviceId: row.deviceId ?? randomUUID(),
        label: row.label ?? "Browser",
        createdAt:
          row.createdAt ?? Math.max(0, row.expiry - WEB_SESSION_SECONDS * 1000),
        lastUsedAt: row.lastUsedAt ?? now(),
        remembered: row.remembered ?? false,
        listeners: new Set(),
      });
  let writes = Promise.resolve();
  let closed = false;
  function changed() {
    if (!storage || closed) return;
    const rows = [...sessions].map(([idHash, session]) => ({
      idHash,
      expiry: session.expiry,
      scope: session.scope,
      deviceId: session.deviceId,
      label: session.label,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      remembered: session.remembered,
    }));
    writes = writes.catch(() => {}).then(() => storage.persist(rows));
    void writes.catch(storage.warn);
  }
  function revokeHash(id: string) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    changed();
    for (const listener of session.listeners) listener();
  }
  function issue(scope: string, options: BrowserLoginOptions) {
    if (closed) throw new Error("The host is restarting. Try again shortly.");
    for (const [id, session] of sessions)
      if (session.expiry <= now()) revokeHash(id);
    if (sessions.size >= 100) {
      const first = sessions.keys().next().value;
      if (first) revokeHash(first);
    }
    const id = randomBytes(32).toString("base64url");
    sessions.set(hash(id), {
      expiry:
        now() +
        (options.remember ? REMEMBERED_BROWSER_SECONDS : WEB_SESSION_SECONDS) *
          1000,
      scope,
      deviceId: randomUUID(),
      label: options.label,
      createdAt: now(),
      lastUsedAt: now(),
      remembered: options.remember,
      listeners: new Set(),
    });
    changed();
    return id;
  }
  if (storage?.restored.some((row) => !row.deviceId)) changed();
  return {
    isClosed: () => closed,
    issue,
    login(
      presented: string,
      scope = "",
      options: BrowserLoginOptions = { remember: false, label: "Browser" },
    ): string | null {
      if (closed) throw new Error("The host is restarting. Try again shortly.");
      if (
        !timingSafeEqual(
          Buffer.from(hash(key), "hex"),
          Buffer.from(hash(presented), "hex"),
        )
      )
        return null;
      return issue(scope, options);
    },
    valid(id: string | undefined, scope = ""): boolean {
      if (closed) return false;
      const idHash = hash(id ?? "");
      const session = sessions.get(idHash);
      if (!session || session.expiry <= now() || session.scope !== scope) {
        revokeHash(idHash);
        return false;
      }
      if (now() - session.lastUsedAt >= 5 * 60_000) {
        session.lastUsedAt = now();
        changed();
      }
      return true;
    },
    deviceId(id: string | undefined) {
      return sessions.get(hash(id ?? ""))?.deviceId ?? null;
    },
    list(scope: string) {
      return [...sessions.values()]
        .filter((row) => row.scope === scope && row.expiry > now())
        .map((row) => ({
          id: row.deviceId,
          label: row.label,
          createdAt: row.createdAt,
          lastUsedAt: row.lastUsedAt,
          expiresAt: row.expiry,
          remembered: row.remembered,
        }));
    },
    revokeDevice(deviceId: string, scope: string) {
      if (closed) throw new Error("The host is restarting. Try again shortly.");
      for (const [id, row] of sessions) {
        if (row.deviceId === deviceId && row.scope === scope) {
          revokeHash(id);
          return true;
        }
      }
      changed();
      return false;
    },
    onRevoke(id: string | undefined, listener: () => void) {
      const session = sessions.get(hash(id ?? ""));
      session?.listeners.add(listener);
      return () => {
        session?.listeners.delete(listener);
      };
    },
    revoke(id: string | undefined) {
      if (closed) throw new Error("The host is restarting. Try again shortly.");
      const idHash = hash(id ?? "");
      if (sessions.has(idHash)) revokeHash(idHash);
      else changed();
    },
    flush: () => writes,
    async close() {
      closed = true;
      for (const session of sessions.values()) {
        for (const listener of session.listeners) listener();
        session.listeners.clear();
      }
      await writes;
    },
  };
}
