import { readlinkSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const PREDECESSOR_WAIT_MS = 20_000;
const PREDECESSOR_POLL_MS = 100;

interface SingleInstanceLockPort {
  request: () => boolean;
  waitForPredecessor: boolean;
  holder: () => number | null;
  isAlive: (pid: number) => boolean;
  pid?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * electron-vite starts a rebuilt main while the previous one is still shutting down; in development, wait for it to exit before asking for the lock.
 * @remarks Electron never emits `ready` in a process whose lock request failed, so a failed request cannot be retried.
 */
export async function acquireSingleInstanceLock({
  request,
  waitForPredecessor,
  holder,
  isAlive,
  pid = process.pid,
  sleep = delay,
  now = Date.now,
}: SingleInstanceLockPort): Promise<boolean> {
  if (waitForPredecessor) {
    const deadline = now() + PREDECESSOR_WAIT_MS;
    let predecessor = holder();
    while (
      predecessor !== null &&
      predecessor !== pid &&
      isAlive(predecessor) &&
      now() < deadline
    ) {
      await sleep(PREDECESSOR_POLL_MS);
      predecessor = holder();
    }
  }
  return request();
}

/** Chromium links `SingletonLock` in the user data folder to `<hostname>-<pid>` of the holder. */
export function singletonLockHolder(userData: string): number | null {
  try {
    const target = readlinkSync(join(userData, "SingletonLock"));
    const pid = Number(target.slice(target.lastIndexOf("-") + 1));
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}
