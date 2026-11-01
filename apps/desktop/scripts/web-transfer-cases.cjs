const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} = require("node:path");
const { setTimeout: pause } = require("node:timers/promises");
const JSZip = require("jszip");

const quote = JSON.stringify;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const terminal = (job) =>
  ["completed", "failed", "cancelled", "interrupted"].includes(job.status);
const fileCount = 32;
const fileSize = 8 * 1024 * 1024;

/** Uses the caller's existing runtime and a temporary AI-off Library; history remains host-owned. */
exports.verifyBrowserTransfers = async function verifyBrowserTransfers({
  win,
  run,
  waitFor,
  snapshot,
  query: hostQuery,
  origin,
  evidence,
  sandbox,
  refreshSession,
}) {
  const startedAt = Date.now();
  const deadline = startedAt + 240000;
  let restoring = false;
  const restoreOnly = process.argv.includes("--transfers-restore");
  const savedPath = process.env.CIRCE_TRANSFER_RESTORE_RECORD;
  if (restoreOnly) {
    assert(savedPath, "Restore requires the exact prior ownership record.");
    assert.equal(dirname(dirname(resolve(savedPath))), resolve(evidence));
    assert.match(basename(dirname(savedPath)), /^transfers-\d+$/);
    assert.equal(basename(savedPath), "ownership-and-results.json");
  }
  const saved = restoreOnly ? readJson(savedPath) : null;
  const query = (name, params = {}) =>
    name === "transferJobs.list"
      ? run(`window.pond.query(${quote(name)},${quote(params)})`)
      : hostQuery(name, params);
  const nonce = saved?.nonce ?? randomUUID();
  const original = saved ? { ...saved.original } : await query("library.info");
  const originalId =
    saved?.original.libraryId ??
    readJson(join(original.path, "metadata.json")).id;
  delete original.libraryId;
  const originalPrefs =
    saved?.originalPrefs ?? (await query("settings.getPrefs"));
  assert.equal(
    originalPrefs.autoImport.enabled,
    false,
    "Use a host with its personal watched folder already disabled.",
  );
  assert.match(
    win.webContents.session.getStoragePath() ?? "",
    /iris-browser-smoke-/,
  );
  const parent = dirname(resolve(original.path));
  const owned = join(parent, `Circe transfers ${nonce}`);
  const libraryPath = join(owned, "Transfers.pond");
  const directory = saved
    ? dirname(resolve(savedPath))
    : join(evidence, `transfers-${startedAt}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const recordPath = join(directory, "ownership-and-results.json");
  const downloadRoot = join(sandbox, "app-data", "web-files", "downloads");
  const record = saved ?? {
    nonce,
    original: { ...original, libraryId: originalId },
    originalPrefs,
    initialHistory: await query("transferJobs.list"),
    owned,
    library: { path: libraryPath, id: null },
    save: {
      title: `Circe transfer ${nonce}`,
      sourceId: null,
      files: [],
    },
    uploads: [],
    jobs: [],
    downloads: [],
    requests: [],
    checks: [],
    samples: [],
    cleanup: {
      restored: false,
      removedLibrary: false,
      removedArtifacts: [],
      errors: [],
      historyPendingHostStop: true,
    },
  };
  if (saved) {
    assert.equal(record.owned, owned);
    assert.equal(record.library.path, libraryPath);
    record.cleanup.previousErrors = [...record.cleanup.errors];
    record.cleanup.errors = [];
  }
  const saveRecord = () => {
    writeFileSync(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 });
    chmodSync(recordPath, 0o600);
  };
  saveRecord();
  const waitUntil = async (read, label, timeout = 30000) => {
    const end = restoring
      ? Date.now() + timeout
      : Math.min(deadline, Date.now() + timeout);
    let cause;
    while (Date.now() < end) {
      try {
        const result = await read();
        if (result) return result;
      } catch (error) {
        cause = error;
      }
      await pause(75);
    }
    throw new Error(`Transfer acceptance timed out: ${label}`, { cause });
  };
  const headers = async () => {
    const cookies = await win.webContents.session.cookies.get({
      url: origin,
      name: "iris_session",
    });
    assert.equal(cookies.length, 1);
    const cookie = `iris_session=${cookies[0].value}`;
    const response = await fetch(`${origin}/web/session`, {
      headers: { cookie },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    return {
      cookie,
      origin,
      "x-iris-library": (await response.json()).libraryId,
    };
  };
  const raw = async (
    route,
    body,
    { filename, method = filename ? "PUT" : "POST" } = {},
  ) => {
    const requestHeaders = {
      ...(await headers()),
      "content-type": filename
        ? "application/octet-stream"
        : "application/json",
    };
    if (filename)
      requestHeaders["x-iris-filename"] = encodeURIComponent(filename);
    const request = {
      method,
      headers: requestHeaders,
      signal: AbortSignal.timeout(60000),
    };
    if (body !== undefined)
      request.body = filename ? body : JSON.stringify(body);
    return fetch(`${origin}/web/${route}`, request);
  };
  const api = async (...args) => {
    const response = await raw(...args);
    assert.equal(response.status, 200, "Owned fixture setup must succeed.");
    return response.json();
  };
  const location = async (path, purpose) => {
    const roots = (await api("locations", { action: "list", purpose })).entries;
    let entry = roots
      .filter(
        (candidate) =>
          resolve(path) === candidate.path ||
          resolve(path).startsWith(`${candidate.path}${sep}`),
      )
      .sort((a, b) => b.path.length - a.path.length)[0];
    assert(entry, "Fixture setup stays inside an advertised host root.");
    for (const name of relative(entry.path, resolve(path))
      .split(sep)
      .filter(Boolean)) {
      const listing = await api("locations", {
        action: "list",
        purpose,
        handle: entry.handle,
        filter: name,
        hidden: true,
      });
      entry = listing.entries.find((candidate) => candidate.name === name);
      assert(entry, "The exact owned directory must be listed.");
    }
    return entry;
  };
  const instance = async () => {
    const response = await fetch(`${origin}/web/ready`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 200);
    return (await response.json()).instance;
  };
  const debuggerApi = win.webContents.debugger;
  assert.equal(
    debuggerApi.isAttached(),
    false,
    "Release the previous GUI probe first.",
  );
  debuggerApi.attach("1.3");
  const click = async (selector, button = "left") => {
    win.focus();
    win.webContents.focus();
    await waitFor("document.hasFocus()");
    const startupPrompt = `Array.from(document.querySelectorAll('[role="dialog"]')).some(dialog => /^(Meet Your Fish|What's New)/.test(dialog.querySelector('h2,[role="heading"]')?.textContent?.trim() ?? '') || Array.from(dialog.querySelectorAll('button')).some(button=>button.textContent.trim()==='Not Now'))`;
    if (await run(startupPrompt)) {
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await waitFor(`!(${startupPrompt})`);
    }
    const point = await run(`new Promise((resolve,reject)=>{
      const started=Date.now();let previous='';let stable=0;
      const check=()=>{const node=document.querySelector(${quote(selector)});
        if(node){node.scrollIntoView({block:'nearest',inline:'nearest'});const rect=node.getBoundingClientRect();
          const point={x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};
          const hit=document.elementFromPoint(point.x,point.y);const current=JSON.stringify(point);
          stable=current===previous?stable+1:0;previous=current;
          if(rect.width&&rect.height&&hit&&node.contains(hit)&&stable>=3){resolve(point);return;}}
        if(Date.now()-started>10000){reject(new Error('Owned transfer control is not clickable'));return;}
        requestAnimationFrame(check);};check();})`);
    await debuggerApi.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...point,
    });
    await debuggerApi.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button,
      buttons: button === "right" ? 2 : 1,
      clickCount: 1,
      ...point,
    });
    await debuggerApi.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button,
      buttons: 0,
      clickCount: 1,
      ...point,
    });
  };
  const chooseAccessKey = async () => {
    let listener;
    let timer;
    const opened = new Promise((resolveChooser, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              "Access-key chooser did not open after host replacement.",
            ),
          ),
        15000,
      );
      listener = (_event, method, params) => {
        if (method === "Page.fileChooserOpened") resolveChooser(params);
      };
      debuggerApi.on("message", listener);
    });
    try {
      const [, chooser] = await Promise.all([
        click('button[aria-label="Choose key file"]'),
        opened,
      ]);
      // The browser reads the existing host key through its genuine file input; no key is logged or rotated.
      await debuggerApi.sendCommand("DOM.setFileInputFiles", {
        backendNodeId: chooser.backendNodeId,
        files: [join(sandbox, "web-access-key")],
      });
    } finally {
      clearTimeout(timer);
      debuggerApi.removeListener("message", listener);
    }
  };
  const load = async (url) => {
    let timer;
    const loading = win.loadURL(url);
    try {
      await Promise.race([
        loading,
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            win.webContents.stop();
            reject(new Error("Finite transfer navigation timed out."));
          }, 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const connect = async (previous) => {
    if (previous)
      await waitUntil(
        async () => (await instance()) !== previous,
        "replacement host",
        60000,
      );
    await load(origin);
    await waitUntil(
      () =>
        run(
          "Boolean(document.querySelector('#host-key-file,[data-slot=window],[data-library-search]'))",
        ),
      "login or application",
      60000,
    );
    if (await run("Boolean(document.querySelector('#host-key-file'))"))
      await chooseAccessKey();
    await waitUntil(
      () =>
        run(
          "Boolean(document.querySelector('[data-slot=window],[data-library-search]'))",
        ),
      "authenticated application",
      60000,
    );
    await refreshSession({ allowLibraryChange: true });
    return query("library.info");
  };
  const transition = async (name, params) => {
    const previous = await instance();
    const result = await api("library", { name, params });
    assert.equal(result.ok, true);
    if (name === "library.createAt") {
      record.library.id = readJson(join(libraryPath, "metadata.json")).id;
      assert.notEqual(record.library.id, originalId);
      saveRecord();
    }
    return connect(result.restarting ? previous : undefined);
  };
  const assertOwnedLibrary = async () => {
    assert.equal((await query("library.info")).path, libraryPath);
    assert.equal(
      readJson(join(libraryPath, "metadata.json")).id,
      record.library.id,
    );
    assert.notEqual(record.library.id, originalId);
  };
  const assertOwnedSave = async () => {
    await assertOwnedLibrary();
    assert(record.save.id);
    const save = await query("saves.get", { id: record.save.id });
    assert.equal(save?.id, record.save.id);
    assert.equal(save.source, "local");
    assert.equal(save.sourceId, record.save.sourceId);
    assert.equal(save.title, record.save.title);
    return save;
  };
  const nativeFile = async (file) => {
    await assertOwnedSave();
    const saveDirectory = join(libraryPath, "items", `${record.save.id}.info`);
    assert.equal(lstatSync(saveDirectory).isSymbolicLink(), false);
    const path = join(saveDirectory, file.path);
    assert.equal(dirname(realpathSync(path)), realpathSync(saveDirectory));
    assert.equal(
      lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(),
      true,
    );
    assert.equal(digest(readFileSync(path)), file.sha256);
    return path;
  };
  const ownedJob = async () => {
    const candidates = (await query("transferJobs.list")).filter(
      (job) =>
        job.request.origin === libraryPath &&
        job.request.originLibraryId === record.library.id &&
        job.request.kind === "export_files" &&
        job.request.ids?.length === 1 &&
        job.request.ids[0] === record.save.id,
    );
    assert(
      candidates.length <= 1,
      "Only one exact owned export job may be targeted.",
    );
    const job = candidates[0];
    if (!job) return null;
    assert.match(job.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    const path = dirname(job.request.destination);
    const id = basename(path);
    assert.match(id, /^[a-f0-9-]{36}$/);
    assert.equal(path, join(downloadRoot, id));
    assert.equal(job.request.destination, join(path, "package"));
    const identity = lstatSync(path);
    assert(identity.isDirectory() && !identity.isSymbolicLink());
    const marker = readJson(join(path, "web-export.json"));
    assert.deepEqual(marker, {
      libraryId: record.library.id,
      kind: "export_files",
      device: identity.dev,
      inode: identity.ino,
    });
    if (!record.jobs.length) {
      assert(!record.initialHistory.some((entry) => entry.id === job.id));
      record.jobs.push({
        id: job.id,
        origin: libraryPath,
        originLibraryId: record.library.id,
        destination: job.request.destination,
        directory: path,
        artifactId: id,
        device: identity.dev,
        inode: identity.ino,
        checkpoint: join(
          sandbox,
          "app-data",
          "transfer-jobs",
          `${job.id}.jsonl`,
        ),
      });
      saveRecord();
    }
    assert.equal(job.id, record.jobs[0].id);
    const sample = {
      at: Date.now(),
      status: job.status,
      completed: job.completed,
      total: job.total,
      receipt: existsSync(join(path, "download.json")),
      zipSize: existsSync(join(path, "download.zip"))
        ? statSync(join(path, "download.zip")).size
        : 0,
    };
    if (record.samples.length < 2000) record.samples.push(sample);
    if (job.status === "completed") {
      assert.equal(
        sample.receipt,
        true,
        "Completed must mean its browser receipt already exists.",
      );
      const receipt = readJson(join(path, "download.json"));
      assert.deepEqual(receipt, {
        libraryId: record.library.id,
        filename: "Saves.zip",
        file: "download.zip",
        count: fileCount,
      });
      const fd = openSync(join(path, "download.zip"), "r");
      try {
        const footer = Buffer.alloc(22);
        assert.equal(readSync(fd, footer, 0, 22, sample.zipSize - 22), 22);
        assert.equal(
          footer.readUInt32LE(0),
          0x06054b50,
          "Completed must mean ZIP central-directory output is finalized.",
        );
      } finally {
        closeSync(fd);
      }
      assert.equal(job.browserDownload, true);
    }
    saveRecord();
    return job;
  };
  const markAction = async (label) => {
    const job = record.jobs[0];
    assert(job);
    await waitFor(
      `Array.from(document.querySelectorAll('section[aria-label="Library transfers"] article')).some(row=>row.querySelector('[title]')?.title===${quote(job.destination)}&&Array.from(row.querySelectorAll('button')).some(button=>button.textContent.trim()===${quote(label)}&&!button.disabled))`,
    );
    await run(
      `(() => {const row=Array.from(document.querySelectorAll('section[aria-label="Library transfers"] article')).find(row=>row.querySelector('[title]')?.title===${quote(job.destination)});const button=Array.from(row.querySelectorAll('button')).find(button=>button.textContent.trim()===${quote(label)});button.setAttribute('data-owned-transfer-action',${quote(`${job.id}-${label}`)});})()`,
    );
    return `[data-owned-transfer-action="${job.id}-${label}"]`;
  };
  const showDownloads = async () => {
    const available =
      "Array.from(document.querySelectorAll('button')).some(button=>Array.from(button.querySelectorAll('span')).some(label=>label.textContent.trim()==='Downloads'))";
    if (!(await run(available))) await click('[aria-label="Toggle Sidebar"]');
    await waitFor(available);
    await run(
      "Array.from(document.querySelectorAll('button')).find(button=>Array.from(button.querySelectorAll('span')).some(label=>label.textContent.trim()==='Downloads')).setAttribute('data-owned-transfers-navigation','true')",
    );
    await click('[data-owned-transfers-navigation="true"]');
    await waitFor(
      "location.pathname==='/downloads' && Boolean(document.querySelector('[data-downloads-search]'))",
    );
  };
  const prepareExportMenu = async () => {
    await load(origin);
    const card = `[data-save-id="${record.save.id}"] [role="option"]`;
    await waitFor(`Boolean(document.querySelector(${quote(card)}))`);
    await click(card, "right");
    await click('[aria-label="Search save operations"]');
    await win.webContents.insertText("Export Files");
    const matching =
      "Array.from(document.querySelectorAll('[role=menuitem]')).filter(node=>Array.from(node.querySelectorAll('span')).some(label=>label.childElementCount===0&&label.textContent.trim()==='Export Files'))";
    await waitFor(`${matching}.length===1`);
    await run(
      `${matching}[0].setAttribute('data-owned-transfer-export','true')`,
    );
    return '[data-owned-transfer-export="true"]';
  };
  const downloadTasks = new Set();
  const downloadListener = (_event, item) => {
    const job = record.jobs[0];
    if (!job || item.getURL() !== `${origin}/web/download/${job.artifactId}`)
      return;
    const entry = {
      url: item.getURL(),
      filename: item.getFilename(),
      path: join(directory, `download-${record.downloads.length + 1}.zip`),
      startedAt: Date.now(),
      state: "running",
    };
    record.downloads.push(entry);
    assert.equal(
      existsSync(entry.path),
      false,
      "A visiting-device download cannot overwrite an existing file.",
    );
    item.setSavePath(entry.path);
    const task = new Promise((resolveDownload) => {
      const timer = setTimeout(() => item.cancel(), 60000);
      item.once("done", (_done, state) => {
        clearTimeout(timer);
        try {
          entry.state = state;
          if (existsSync(entry.path)) {
            const stat = lstatSync(entry.path);
            assert(stat.isFile() && !stat.isSymbolicLink());
            entry.device = stat.dev;
            entry.inode = stat.ino;
            entry.size = stat.size;
          }
          if (state === "completed")
            entry.sha256 = digest(readFileSync(entry.path));
        } catch (error) {
          entry.error = error.message;
        }
        saveRecord();
        resolveDownload();
      });
    }).finally(() => downloadTasks.delete(task));
    downloadTasks.add(task);
    saveRecord();
  };
  win.webContents.session.on("will-download", downloadListener);
  const network = (_event, method, params) => {
    if (
      method !== "Network.requestWillBeSent" ||
      params.request.url !== `${origin}/web/files` ||
      !params.request.postData
    )
      return;
    const input = JSON.parse(params.request.postData);
    if (["transferJobs.retry", "transferJobs.download"].includes(input.name)) {
      assert.equal(
        input.params.id,
        record.jobs[0]?.id,
        "Only the exact owned job is actionable.",
      );
      record.requests.push({
        at: Date.now(),
        name: input.name,
        id: input.params.id,
      });
      saveRecord();
    }
  };
  debuggerApi.on("message", network);
  const prove = async (name, details = {}) => {
    record.checks.push({ name, passed: true, ...details });
    saveRecord();
    await snapshot(`transfers-${nonce}-${name}`);
  };
  let parked = record.parked;
  let failure;
  try {
    await debuggerApi.sendCommand("Page.enable");
    await debuggerApi.sendCommand("Network.enable");
    await debuggerApi.sendCommand("Page.setInterceptFileChooserDialog", {
      enabled: true,
    });
    if (!restoreOnly) {
      assert.equal(existsSync(owned), false);
      await api("locations", {
        action: "mkdir",
        purpose: "parent",
        parent: (await location(parent, "parent")).handle,
        name: basename(owned),
      });
      const ownerIdentity = lstatSync(owned);
      record.ownedIdentity = {
        device: ownerIdentity.dev,
        inode: ownerIdentity.ino,
      };
      saveRecord();
      const info = await transition("library.createAt", {
        parent: (await location(owned, "parent")).handle,
        name: "Transfers",
      });
      assert.equal(info.path, libraryPath);
      await assertOwnedLibrary();
      assert.equal(
        Object.keys((await query("settings.getPrefs")).sync.accounts).length,
        0,
      );
      await query("settings.setPrefs", {
        ai: {
          semanticSearch: false,
          enableCaption: false,
          enableOcr: false,
          enableTranscript: false,
          enableClip: false,
          enableAesthetic: false,
          enableSensitiveContent: false,
          enableAutoTitle: false,
          enableSuggestedTags: false,
        },
      });
      const payload = Buffer.alloc(fileSize);
      for (let index = 0; index < fileCount; index++) {
        payload.fill(0, 0, 256);
        payload.write(`OWNED CIRCE TRANSFER ${nonce} ORIGINAL ${index}\n`);
        const filename = `owned-${String(index).padStart(2, "0")} # 水.bin`;
        const upload = await api("upload", payload, { filename });
        assert.equal(upload.size, fileSize);
        record.uploads.push({
          token: upload.token,
          filename,
          size: fileSize,
          sha256: digest(payload),
          removed: false,
        });
        if (record.uploads.length === 1)
          record.save.sourceId = `web-upload:${upload.token.replace(/^iris-upload:/, "")}`;
        saveRecord();
      }
      const created = await api("files", {
        name: "saves.createManual",
        params: {
          title: record.save.title,
          filePaths: record.uploads.map((upload) => upload.token),
        },
      });
      assert.equal(created.ok, true);
      record.save.id = created.id;
      saveRecord();
      const save = await assertOwnedSave();
      assert.equal(save.status, "complete");
      assert.equal(save.files.length, fileCount);
      record.save.files = save.files;
      saveRecord();
      for (const upload of record.uploads) {
        const file = save.files.find(
          (candidate) => candidate.path === upload.filename,
        );
        assert(file);
        assert.equal(file.size, upload.size);
        assert.equal(file.sha256, upload.sha256);
        await api(`upload/${encodeURIComponent(upload.token)}`, undefined, {
          method: "DELETE",
        });
        upload.removed = true;
        saveRecord();
      }
      const first = record.save.files[0];
      const firstPath = await nativeFile(first);
      const identity = lstatSync(firstPath);
      parked = {
        path: firstPath,
        parked: join(dirname(firstPath), `.owned-${nonce}.parked`),
        device: identity.dev,
        inode: identity.ino,
        sha256: first.sha256,
      };
      record.parked = parked;
      saveRecord();
      assert.equal(existsSync(parked.parked), false);
      const exportAction = await prepareExportMenu();
      assert.equal(lstatSync(parked.path).ino, parked.inode);
      renameSync(parked.path, parked.parked);
      await click(exportAction);
      const failed = await waitUntil(async () => {
        const job = await ownedJob();
        return job?.status === "failed" ? job : null;
      }, "genuine missing-original export failure");
      assert.match(failed.error, /ENOENT|no such file|not found/i);
      assert.equal(
        existsSync(join(record.jobs[0].directory, "download.json")),
        false,
      );
      assert.equal(record.downloads.length, 0);
      renameSync(parked.parked, parked.path);
      parked.restored = true;
      assert.equal(lstatSync(parked.path).ino, parked.inode);
      assert.equal(digest(readFileSync(parked.path)), parked.sha256);
      saveRecord();
      await showDownloads();
      await prove("genuine-owned-export-failure-shows-retry");
      const retryCursor = record.requests.length;
      await click(await markAction("Retry"));
      await waitUntil(
        () =>
          record.requests
            .slice(retryCursor)
            .some((request) => request.name === "transferJobs.retry"),
        "real Retry HTTP request",
      );
      const cancelSelector = await markAction("Cancel");
      await waitFor(
        `!document.querySelector(${quote(cancelSelector)}).disabled`,
      );
      await click(cancelSelector);
      const cancelled = await waitUntil(
        async () => {
          const job = await ownedJob();
          return job?.status === "cancelled" ? job : null;
        },
        "Cancel during pending Retry",
        60000,
      );
      assert.equal(cancelled.id, failed.id);
      assert.equal(
        existsSync(join(record.jobs[0].directory, "download.json")),
        false,
      );
      assert.equal(record.downloads.length, 0);
      await prove("visible-cancel-remains-usable-during-retry");
      const downloadCursor = record.downloads.length;
      await click(await markAction("Retry"));
      await waitUntil(
        async () => (await ownedJob())?.status === "completed",
        "retried export completion after ZIP and receipt",
        60000,
      );
      const received = await waitUntil(
        () =>
          record.downloads
            .slice(downloadCursor)
            .find((entry) => entry.state === "completed"),
        "retried export visiting-device download",
        60000,
      );
      assert.equal(received.filename, "Saves.zip");
      const zip = await JSZip.loadAsync(readFileSync(received.path), {
        checkCRC32: true,
      });
      const manifests = Object.values(zip.files).filter(
        (entry) =>
          !entry.dir && /^pond-export(?:-\d+)?\.json$/.test(entry.name),
      );
      assert(manifests.length >= 1);
      const exported = JSON.parse(await manifests.at(-1).async("string"));
      assert.equal(exported.saves.length, 1);
      assert.equal(exported.saves[0].id, record.save.id);
      assert.equal(exported.saves[0].sourceId, record.save.sourceId);
      assert.equal(exported.exportedFiles.length, fileCount);
      for (const file of record.save.files) {
        const item = exported.exportedFiles.find(
          (entry) =>
            entry.saveId === record.save.id && entry.sourcePath === file.path,
        );
        assert(item && zip.file(item.path));
        assert.equal(
          digest(await zip.file(item.path).async("nodebuffer")),
          file.sha256,
        );
      }
      await prove(
        "retry-completes-finalized-native-zip-before-completed-and-download",
        { files: fileCount, bytes: fileCount * fileSize },
      );
      for (const reload of [false, true]) {
        if (reload) {
          await run("window.__ownedTransferReloadMarker=true");
          win.reload();
          await waitFor(
            "!window.__ownedTransferReloadMarker && document.readyState==='complete' && location.pathname==='/downloads' && Boolean(document.querySelector('[data-downloads-search]'))",
          );
        }
        const cursor = record.downloads.length;
        await click(await markAction("Download"));
        const repeated = await waitUntil(
          () =>
            record.downloads
              .slice(cursor)
              .find((entry) => entry.state === "completed"),
          "explicit completed Download",
          60000,
        );
        assert.equal(repeated.sha256, received.sha256);
        assert.equal(repeated.size, received.size);
      }
      assert.equal(
        record.requests.filter(
          (request) => request.name === "transferJobs.download",
        ).length,
        2,
      );
      await prove("completed-download-and-reloaded-download-bypass-auto-dedup");
    }
  } catch (error) {
    failure = error;
    record.failure = {
      message: error.message ?? String(error),
      stack: error.stack,
    };
    await snapshot(`transfers-${nonce}-failure`).catch(() => {});
  } finally {
    restoring = true;
    try {
      await waitUntil(
        async () => {
          await connect();
          return true;
        },
        "cleanup reconnect",
        60000,
      );
      if (
        !record.library.id &&
        existsSync(join(libraryPath, "metadata.json"))
      ) {
        record.library.id = readJson(join(libraryPath, "metadata.json")).id;
        assert.notEqual(record.library.id, originalId);
        saveRecord();
      }
      if (parked && existsSync(parked.parked)) {
        assert.equal(existsSync(parked.path), false);
        const identity = lstatSync(parked.parked);
        assert.equal(identity.dev, parked.device);
        assert.equal(identity.ino, parked.inode);
        assert.equal(digest(readFileSync(parked.parked)), parked.sha256);
        renameSync(parked.parked, parked.path);
        parked.restored = true;
      }
      if ((await query("library.info")).path === libraryPath) {
        const job = await ownedJob();
        if (job && !terminal(job)) {
          await query("transferJobs.cancel", { id: job.id });
          await waitUntil(
            async () => terminal(await ownedJob()),
            "owned transfer drain",
            60000,
          );
        }
        for (const upload of record.uploads)
          if (!upload.removed) {
            await api(`upload/${encodeURIComponent(upload.token)}`, undefined, {
              method: "DELETE",
            });
            upload.removed = true;
          }
      }
      await Promise.allSettled(downloadTasks);
      if ((await query("library.info")).path !== original.path)
        await transition("library.switchTo", {
          source: (await location(original.path, "open")).handle,
        });
      const active = await query("library.info");
      assert.deepEqual(active, original);
      assert.equal(readJson(join(active.path, "metadata.json")).id, originalId);
      assert.deepEqual(await query("settings.getPrefs"), originalPrefs);
      const history = await query("transferJobs.list");
      for (const initial of record.initialHistory) {
        const current = history.find((job) => job.id === initial.id);
        assert(current, "Existing transfer history remains present.");
        assert.deepEqual(current.request, initial.request);
      }
      record.cleanup.restored = true;
      saveRecord();
      if (record.jobs.length) {
        const foreign = await raw("files", {
          name: "transferJobs.download",
          params: { id: record.jobs[0].id },
        });
        await foreign.arrayBuffer();
        assert.equal(
          foreign.status,
          409,
          "The original Library cannot recover the owned fixture Library's artifact.",
        );
      }
      for (const job of record.jobs) {
        const current = history.find((entry) => entry.id === job.id);
        assert(current && terminal(current));
        assert.equal(current.request.originLibraryId, record.library.id);
        assert.equal(current.request.origin, libraryPath);
        const identity = lstatSync(job.directory);
        assert.equal(identity.dev, job.device);
        assert.equal(identity.ino, job.inode);
        assert.deepEqual(readJson(join(job.directory, "web-export.json")), {
          libraryId: record.library.id,
          kind: "export_files",
          device: job.device,
          inode: job.inode,
        });
        assert.equal(dirname(job.directory), downloadRoot);
        rmSync(job.directory, { recursive: true });
        record.cleanup.removedArtifacts.push(job.artifactId);
      }
      if (existsSync(owned)) {
        const identity = lstatSync(owned);
        assert.equal(identity.dev, record.ownedIdentity.device);
        assert.equal(identity.ino, record.ownedIdentity.inode);
        assert(identity.isDirectory() && !identity.isSymbolicLink());
        assert.deepEqual(readdirSync(owned), ["Transfers.pond"]);
        assert.equal(
          readJson(join(libraryPath, "metadata.json")).id,
          record.library.id,
        );
        assert.notEqual(record.library.id, originalId);
        await query("library.recent.remove", { path: libraryPath });
        rmSync(owned, { recursive: true });
        record.cleanup.removedLibrary = true;
      }
      for (const entry of record.downloads)
        if (existsSync(entry.path)) {
          const identity = lstatSync(entry.path);
          assert.equal(identity.dev, entry.device);
          assert.equal(identity.ino, entry.inode);
          assert.equal(dirname(entry.path), directory);
          rmSync(entry.path);
          entry.removed = true;
        }
      await snapshot(`transfers-${nonce}-original-restored`);
    } catch (error) {
      record.cleanup.errors.push(error.message);
    } finally {
      win.webContents.session.removeListener("will-download", downloadListener);
      debuggerApi.removeListener("message", network);
      if (debuggerApi.isAttached()) debuggerApi.detach();
      record.elapsedMs = Date.now() - startedAt;
      saveRecord();
    }
  }
  assert.equal(
    record.cleanup.errors.length,
    0,
    record.cleanup.errors.join("\n"),
  );
  assert.equal(record.cleanup.restored && record.cleanup.removedLibrary, true);
  if (failure) throw failure;
  console.log(
    restoreOnly ? "WEB_TRANSFERS_RESTORED" : "WEB_TRANSFERS_PASSED",
    JSON.stringify({
      checks: record.checks.length,
      record: recordPath,
      historyPendingHostStop: record.jobs.map((job) => job.id),
    }),
  );
  return record;
};
