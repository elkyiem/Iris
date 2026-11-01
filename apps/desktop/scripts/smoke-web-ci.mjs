import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { spawnProcessGroup } from "./process-group.mjs";

if (!process.env.CI)
  throw new Error(
    "This ephemeral runner is for CI. Local chats use the designated shared host.",
  );
const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(
  join(tmpdir(), "iris-web-ci-upgrade-220-pairing-"),
);
const env = {
  ...process.env,
  POND_SANDBOX: directory,
  CIRCE_WEB_PORT: "4792",
  CIRCE_WEB_ORIGIN: "http://127.0.0.1:4792",
  CIRCE_WEB_FIXTURES: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const hostGroup = spawnProcessGroup(
  process.execPath,
  ["scripts/start-web.mjs"],
  {
    cwd,
    env,
    stdio: "inherit",
  },
);
const host = hostGroup.child;
const run = (executable, args, extraEnv = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...env, ...extraEnv },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Verification process exited ${code}.`)),
    );
  });
const deadline = setTimeout(() => {
  host.kill("SIGTERM");
  process.exitCode = 1;
}, 600000);
try {
  const started = Date.now();
  while (true) {
    if (host.exitCode !== null)
      throw new Error("The isolated host exited before readiness.");
    try {
      if ((await fetch(`${env.CIRCE_WEB_ORIGIN}/web/session`)).status === 401)
        break;
    } catch {}
    if (Date.now() - started > 60000)
      throw new Error("The isolated host did not become ready.");
    await pause(250);
  }
  await run(process.execPath, ["scripts/smoke-web.mjs"]);
  await run(electron, ["scripts/smoke-web-network.cjs"]);
  await run(process.execPath, ["scripts/smoke-web-parity.mjs"]);
  await run(process.execPath, ["scripts/smoke-web-identity.mjs"]);
  await run(electron, ["scripts/smoke-web-browser.cjs", "--extension-setup"]);
  await run(process.execPath, ["scripts/smoke-web-extension.mjs"]);
  await run(process.execPath, ["scripts/smoke-web-imports.mjs"]);
  await run(process.execPath, ["scripts/smoke-web-package.mjs"]);
  await run(process.execPath, ["scripts/smoke-web-canvas.mjs"]);
  await run(electron, ["scripts/smoke-web-browser.cjs"]);
  await run(electron, ["scripts/smoke-web-browser.cjs", "--identity"]);
  await run(electron, ["scripts/smoke-web-browser.cjs", "--release-audit"], {
    CIRCE_RELEASE_PLATFORM: "Win32",
  });
  await run(electron, ["scripts/smoke-web-browser.cjs", "--release-audit"], {
    CIRCE_RELEASE_PLATFORM: "MacIntel",
  });
  await run(process.execPath, ["scripts/smoke-web-release.mjs"]);
  await run(electron, ["scripts/smoke-web-browser.cjs", "--upgrade-220"]);
  await run(electron, ["scripts/smoke-web-browser.cjs", "--pairing"]);
} finally {
  clearTimeout(deadline);
  await hostGroup.stop();
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
