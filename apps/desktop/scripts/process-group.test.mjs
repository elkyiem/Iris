import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { spawnProcessGroup } from "./process-group.mjs";

test("stops a descendant that outlives its launcher before deleting its profile", {
  skip: process.platform === "win32",
  timeout: 5000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "circe-process-group-"));
  const heartbeat = join(directory, "heartbeat");
  const descendant = `
    const {appendFileSync}=require('node:fs');
    process.on('SIGTERM',()=>{});
    appendFileSync(process.argv[1],'ready');
    console.log('ready');
    setInterval(()=>appendFileSync(process.argv[1],'.'),10);
  `;
  const launcher = `
    const {spawn}=require('node:child_process');
    process.on('SIGTERM',()=>process.exit(0));
    spawn(process.execPath,['-e',process.argv[1],process.argv[2]],{stdio:'inherit'});
    setInterval(()=>{},1000);
  `;
  const group = spawnProcessGroup(
    process.execPath,
    ["-e", launcher, descendant, heartbeat],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    const lines = createInterface({ input: group.child.stdout });
    for await (const line of lines) {
      if (line === "ready") break;
    }
    lines.close();
    await group.stop(50);
    const stopped = await readFile(heartbeat, "utf8");
    await pause(100);
    assert.equal(await readFile(heartbeat, "utf8"), stopped);
    await rm(directory, { recursive: true });
  } finally {
    await group.stop(0);
    await rm(directory, { recursive: true, force: true });
  }
});
