import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";

/** Own the launcher and its descendants until fixture cleanup has finished. */
export function spawnProcessGroup(command, args, options) {
  if (process.platform === "win32")
    throw new Error("Process-group fixtures require a Unix host.");
  const child = spawn(command, args, { ...options, detached: true });
  const closed = new Promise((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
  const signal = (value) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, value);
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ESRCH")
      )
        throw error;
    }
  };
  return {
    child,
    async stop(graceMs = 5000) {
      signal("SIGTERM");
      await Promise.race([closed, pause(graceMs)]);
      // The launcher may exit before Chromium's last profile writer does.
      signal("SIGKILL");
      await closed;
    },
  };
}
