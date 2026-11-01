const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
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
const sharp = require("sharp");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const picker = '[data-copy-storage-picker="true"]';
const gib = 1024 ** 3;

/** The caller owns the existing runtime. All Library/file writes stay in this run's parent. */
exports.verifyBrowserLibraryCopyStorage =
  async function verifyBrowserLibraryCopyStorage({
    win,
    run,
    click,
    waitFor,
    snapshot,
    query,
    origin,
    evidence,
    sandbox,
    refreshSession,
  }) {
    const restoreOnly = process.argv.includes("--library-copy-storage-restore");
    const recordPath = join(evidence, "copy-storage-restore.json");
    const saved = restoreOnly ? readJson(recordPath) : null;
    const original = saved?.original ?? (await query("library.info"));
    const originalPrefs =
      saved?.originalPrefs ?? (await query("settings.getPrefs"));
    assert.equal(
      originalPrefs.autoImport.enabled,
      false,
      "The personal watched folder must be disabled before fixture Library transitions.",
    );
    const originalId =
      saved?.original.libraryId ??
      readJson(join(original.path, "metadata.json")).id;
    assert.equal(
      readJson(join(original.path, "metadata.json")).id,
      originalId,
      "Recovery must retain the original Library identity.",
    );
    const parent = dirname(resolve(original.path));
    const owned =
      saved?.owned ??
      join(parent, `Circe copy storage ${process.pid}-${Date.now()}`);
    const sourcePath = join(owned, "Source.pond");
    const targetPath = join(owned, "Target.pond");
    const pointer = [
      join(sandbox, "app-data", "library-location.json"),
      join(sandbox, "library-location.json"),
    ].find(existsSync);
    const record = saved ?? {
      original: { ...original, libraryId: originalId },
      originalPrefs,
      owned,
      sourcePath,
      targetPath,
      libraries: [],
      checks: {},
      uploads: [],
      storageEvents: [],
      transitions: [],
      restored: false,
      cleaned: false,
    };
    const saveRecord = () => {
      writeFileSync(recordPath, JSON.stringify(record, null, 2), {
        mode: 0o600,
      });
      chmodSync(recordPath, 0o600);
    };
    saveRecord();
    const deadline = Date.now() + 220000;
    let restoring = false;
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
        await pause(200);
      }
      throw new Error(`Copy/storage timed out: ${label}`, { cause });
    };
    const prove = async (name) => {
      record.checks[name] = true;
      saveRecord();
      const label = `copy-storage-${basename(owned).split(" ").at(-1)}-${name}`;
      await snapshot(label);
      for (const extension of ["png", "txt"])
        chmodSync(join(evidence, `${label}.${extension}`), 0o600);
    };
    const instance = async () => {
      const response = await fetch(`${origin}/web/ready`, {
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      assert.equal(response.status, 200);
      return (await response.json()).instance;
    };
    const headers = async () => {
      const cookies = await win.webContents.session.cookies.get({
        url: origin,
        name: "iris_session",
      });
      assert.equal(
        cookies.length,
        1,
        "Use the actual authenticated browser session.",
      );
      const cookie = `iris_session=${cookies[0].value}`;
      const session = await fetch(`${origin}/web/session`, {
        headers: { cookie },
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(session.status, 200);
      return {
        cookie,
        origin,
        "x-iris-library": (await session.json()).libraryId,
      };
    };
    const api = async (
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
        signal: AbortSignal.timeout(30000),
      };
      if (body !== undefined)
        request.body = filename ? body : JSON.stringify(body);
      const response = await fetch(`${origin}/web/${route}`, request);
      assert.equal(
        response.status,
        200,
        `Fixture ${route} request must succeed.`,
      );
      return response.json();
    };
    const location = async (path, purpose) => {
      const roots = (await api("locations", { action: "list", purpose }))
        .entries;
      let entry = roots
        .filter(
          (candidate) =>
            resolve(path) === candidate.path ||
            resolve(path).startsWith(`${candidate.path}${sep}`),
        )
        .sort((a, b) => b.path.length - a.path.length)[0];
      assert.ok(
        entry,
        "The fixture path must belong to an advertised location.",
      );
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
        assert.ok(entry, "The exact fixture directory must be listed.");
      }
      return entry;
    };
    const debuggerApi = win.webContents.debugger;
    assert.equal(debuggerApi.isAttached(), false);
    debuggerApi.attach("1.3");
    await debuggerApi.sendCommand("Page.enable");
    await debuggerApi.sendCommand("Network.enable");
    await debuggerApi.sendCommand("Page.setInterceptFileChooserDialog", {
      enabled: true,
    });
    const pending = new Map();
    const copies = [];
    let copyRequests = 0;
    const network = (_event, method, params) => {
      if (
        method === "Network.eventSourceMessageReceived" &&
        params.eventName === "storage"
      ) {
        record.storageEvents.push({
          at: Date.now(),
          status: JSON.parse(params.data),
        });
        if (record.storageEvents.length > 100) record.storageEvents.shift();
        saveRecord();
      }
      if (
        method === "Network.requestWillBeSent" &&
        params.request.url === `${origin}/web/copy-library`
      ) {
        copyRequests++;
        pending.set(params.requestId, true);
      }
      if (
        method !== "Network.loadingFinished" ||
        !pending.has(params.requestId)
      )
        return;
      pending.delete(params.requestId);
      void debuggerApi
        .sendCommand("Network.getResponseBody", { requestId: params.requestId })
        .then(({ body, base64Encoded }) => {
          copies.push(
            JSON.parse(
              base64Encoded ? Buffer.from(body, "base64").toString() : body,
            ),
          );
        })
        .catch((error) => copies.push({ captureError: error.message }));
    };
    debuggerApi.on("message", network);
    const connect = async (previous) => {
      if (previous)
        await waitUntil(
          async () => (await instance()) !== previous,
          "replacement host",
          60000,
        );
      await win.loadURL(origin);
      await waitUntil(
        () =>
          run(
            "Boolean(document.querySelector('#host-key-file, [data-slot=window], [data-library-search]'))",
          ),
        "login or app",
        60000,
      );
      if (await run("Boolean(document.querySelector('#host-key-file'))")) {
        let listener;
        let timer;
        const opened = new Promise((resolveChooser, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error("The actual access-key chooser did not open.")),
            15000,
          );
          listener = (_event, method, params) => {
            if (method === "Page.fileChooserOpened") resolveChooser(params);
          };
          debuggerApi.on("message", listener);
        });
        try {
          const [, chosen] = await Promise.all([
            click('button[aria-label="Choose key file"]'),
            opened,
          ]);
          await debuggerApi.sendCommand("DOM.setFileInputFiles", {
            backendNodeId: chosen.backendNodeId,
            files: [join(sandbox, "web-access-key")],
          });
        } finally {
          clearTimeout(timer);
          debuggerApi.removeListener("message", listener);
        }
      }
      await waitUntil(
        () =>
          run(
            "Boolean(document.querySelector('[data-slot=window], [data-library-search]'))",
          ),
        "authenticated application",
        60000,
      );
      await refreshSession({ allowLibraryChange: true });
      return query("library.info");
    };
    const transition = async (name, params) => {
      const previous = await instance();
      const started = Date.now();
      const result = await api("library", { name, params });
      assert.equal(result.ok, true, "Disposable Library setup must succeed.");
      if (name === "library.createAt") {
        const intended = record.libraries.find(
          (entry) => entry.path === join(owned, `${params.name}.pond`),
        );
        assert.ok(intended);
        intended.id = readJson(join(intended.path, "metadata.json")).id;
        assert.notEqual(intended.id, originalId);
        saveRecord();
      }
      const timing = { name, requestMs: Date.now() - started };
      record.transitions.push(timing);
      saveRecord();
      const current = await connect(result.restarting ? previous : undefined);
      timing.reconnectedMs = Date.now() - started;
      saveRecord();
      return current;
    };
    const openLibrary = async (path) =>
      transition("library.switchTo", {
        source: (await location(path, "open")).handle,
      });
    const assertOwnedLibrary = async (path) => {
      assert.ok([sourcePath, targetPath].includes(path));
      assert.equal((await query("library.info")).path, path);
      const known = record.libraries.find((entry) => entry.path === path);
      assert.ok(known);
      assert.equal(readJson(join(path, "metadata.json")).id, known.id);
      assert.notEqual(known.id, originalId);
    };
    const configureOwned = async (path) => {
      await assertOwnedLibrary(path);
      const prefs = await query("settings.getPrefs");
      record.libraries.find((entry) => entry.path === path).prefs = prefs;
      saveRecord();
      assert.equal(
        Object.keys(prefs.sync.accounts).length,
        0,
        "Never pause personal Source accounts while testing a guard.",
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
        storage: {
          guardsEnabled: false,
          maxLibraryGb: 50,
          warnAtPercent: 80,
          action: "warn",
        },
      });
    };
    const mark = async (selector, predicate) => {
      record.uiPhase = `Find ${selector}: ${predicate}`;
      saveRecord();
      await waitFor(
        `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(node=>node.getBoundingClientRect().width>0 && (${predicate}))`,
      );
      await run(`(() => {
      document.querySelectorAll('[data-copy-storage-control]').forEach(node=>node.removeAttribute('data-copy-storage-control'));
      Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node=>node.getBoundingClientRect().width>0 && (${predicate})).setAttribute('data-copy-storage-control','target');
    })()`);
      return '[data-copy-storage-control="target"]';
    };
    const clickText = async (selector, text) =>
      click(
        await mark(
          selector,
          `node.textContent.trim()===${JSON.stringify(text)}`,
        ),
      );
    const replace = async (selector, text) => {
      await click(selector);
      await waitFor(
        `document.activeElement===document.querySelector(${JSON.stringify(selector)})`,
      );
      win.webContents.selectAll();
      await win.webContents.insertText(text);
      await waitFor(
        `document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(text)}`,
      );
    };
    const sidebar = async () => {
      await waitFor(
        "document.querySelector('[aria-label=\"Toggle Sidebar\"]')",
      );
      if (
        !(await run(
          "document.querySelector('[data-slot=window]')?.hasAttribute('data-left-open')",
        ))
      )
        await click('[aria-label="Toggle Sidebar"]');
    };
    const libraryScreen = async () => {
      await sidebar();
      if (
        await run(
          "Array.from(document.querySelectorAll('button')).some(node=>node.textContent.trim()==='Exit settings')",
        )
      )
        await clickText("button", "Exit settings");
      await click(
        await mark(
          '[role=navigation][aria-label="Library"] button',
          "Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()==='All')",
        ),
      );
      await waitFor("location.pathname==='/'");
    };
    const copyAction = async () => {
      await libraryScreen();
      await run(`(() => {
        window.__copyStorageEvents=[];
        if (window.__copyStorageEventsInstalled) return;
        window.__copyStorageEventsInstalled=true;
        for (const type of ['pointerdown','pointerup','mousedown','mouseup','click','focusin','input']) document.addEventListener(type,event=>{
          const node=event.target;
          const owner=node instanceof Element ? node.closest('[role=menuitem],input,[role=option]') : null;
          if (!owner) return;
          window.__copyStorageEvents.push({type,at:performance.now(),trusted:event.isTrusted,tag:owner.tagName,role:owner.getAttribute('role'),label:owner.getAttribute('aria-label'),text:owner.textContent?.slice(0,100),x:event.clientX,y:event.clientY,active:document.activeElement?.getAttribute('aria-label')??document.activeElement?.getAttribute('role')});
          if(window.__copyStorageEvents.length>100)window.__copyStorageEvents.shift();
        },true);
      })()`);
      const card = `[data-save-id="${record.fixture.id}"] [role="option"]`;
      await waitFor(`document.querySelector(${JSON.stringify(card)})`);
      await click(card);
      const point = await run(
        `(()=>{const r=document.querySelector(${JSON.stringify(card)}).getBoundingClientRect();return {x:Math.round(r.x+8),y:Math.round(r.y+8)}})()`,
      );
      for (const type of ["mouseDown", "mouseUp"])
        win.webContents.sendInputEvent({
          type,
          button: "right",
          clickCount: 1,
          ...point,
        });
      await replace(
        '[aria-label="Search save operations"]',
        "Add to Other Library",
      );
      await waitFor(
        "Array.from(document.querySelectorAll('[role=menuitem]')).filter(node=>node.getBoundingClientRect().width>0).length===1",
      );
      await click(
        await mark(
          '[role="menuitem"]',
          "node.textContent.includes('Add to Other Library')",
        ),
      );
      record.menuInputEvents = await run("window.__copyStorageEvents");
      saveRecord();
      await waitFor(
        "document.querySelector('[role=dialog] [aria-label=\"Host folders\"]')",
      );
      await run(
        "document.querySelector('[aria-label=\"Host folders\"]').closest('[role=dialog]').setAttribute('data-copy-storage-picker','true')",
      );
      await waitFor(
        `document.querySelector(${JSON.stringify(`${picker} [aria-label="Host folders"]`)})?.getAttribute('aria-busy')==='false'`,
      );
    };
    const selectTarget = async (path) => {
      await click(
        await mark(
          `${picker} [role=option]`,
          "node.querySelector('span')?.textContent==='Library folders'",
        ),
        2,
      );
      await waitFor(
        `Array.from(document.querySelectorAll(${JSON.stringify(`${picker} [title]`)})).some(node=>node.title===${JSON.stringify(owned)})`,
      );
      await replace(
        `${picker} [aria-label="Filter host folders"]`,
        basename(path),
      );
      await click(
        await mark(
          `${picker} [role=option]`,
          `node.querySelector('span')?.textContent===${JSON.stringify(basename(path))}`,
        ),
      );
      await clickText(`${picker} button`, "Open");
      await waitFor("!document.querySelector('[aria-label=\"Host folders\"]')");
    };
    const copyReply = (cursor) =>
      waitUntil(() => copies[cursor], "actual Copy to Library response");
    const tree = (directory) => {
      const entries = {};
      const visit = (path) => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
          assert.equal(entry.isSymbolicLink(), false);
          const child = join(path, entry.name);
          if (entry.isDirectory()) visit(child);
          else
            entries[relative(directory, child)] = digest(readFileSync(child));
        }
      };
      visit(directory);
      return entries;
    };
    const targetSave = () => {
      const entries = readdirSync(join(targetPath, "items")).filter((name) =>
        name.endsWith(".info"),
      );
      const matches = entries
        .map((name) => ({
          directory: join(targetPath, "items", name),
          info: readJson(join(targetPath, "items", name, "info.json")),
        }))
        .filter(
          ({ info }) =>
            info.source === "local" &&
            info.sourceId === record.fixture.sourceId,
        );
      assert.equal(matches.length, 1);
      return matches[0];
    };
    const verifySource = async () => {
      await assertOwnedLibrary(sourcePath);
      const row = await query("saves.get", { id: record.fixture.id });
      assert.equal(row.title, record.fixture.title);
      assert.equal(row.sourceId, record.fixture.sourceId);
      assert.equal(row.source, "local");
      assert.equal(row.notes, record.fixture.note);
      assert.ok(row.tags.includes(record.fixture.tag));
      assert.equal(
        (await query("saves.listPage", { limit: 10 })).rows.length,
        1,
      );
      const originalFile = row.files.find((file) => file.kind === "image");
      assert.ok(originalFile);
      assert.equal(
        digest(
          readFileSync(
            join(sourcePath, "items", `${row.id}.info`, originalFile.path),
          ),
        ),
        record.fixture.sha256,
      );
      return row;
    };
    const field = async (selector, title) => {
      const target = await mark(
        selector,
        String.raw`node.getAttribute('aria-label')===${JSON.stringify(title)} || (node.getAttribute('aria-labelledby')||'').split(/\s+/).some(id=>document.getElementById(id)?.textContent.trim()===${JSON.stringify(title)})`,
      );
      await waitFor(
        `!document.querySelector(${JSON.stringify(target)}).disabled && document.querySelector(${JSON.stringify(target)}).getAttribute('aria-disabled')!=='true'`,
      );
      return target;
    };
    const switchLimit = async (enabled) => {
      const selector = await field('[role="switch"]', "Limit Library Size");
      if (
        (await run(
          `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-checked')==='true'`,
        )) !== enabled
      )
        await click(selector);
      await waitUntil(
        async () =>
          (await query("settings.getPrefs")).storage.guardsEnabled === enabled,
        "actual storage switch persisted",
      );
    };
    const selectSetting = async (title, label, key, value) => {
      await click(
        await field('[role="combobox"],button[aria-haspopup="listbox"]', title),
      );
      await click(
        await mark(
          '[role="option"]',
          String.raw`node.textContent.replace(/\s+/g,' ').trim()===${JSON.stringify(label)}`,
        ),
      );
      await waitUntil(
        async () =>
          Object.is((await query("settings.getPrefs")).storage[key], value),
        `actual ${title} selection persisted`,
      );
    };
    const storageScreen = async () => {
      await libraryScreen();
      await click('[aria-label="Library Menu"]');
      await click(
        await mark(
          '[role="menuitem"]',
          "Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()==='Settings')",
        ),
      );
      await click(
        await mark(
          '[role=navigation][aria-label="Settings"] button',
          "Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()==='Storage')",
        ),
      );
      await waitFor(
        "location.pathname==='/settings/storage' && document.body.textContent.includes('Storage Limits')",
      );
      await field('[role="switch"]', "Limit Library Size");
    };
    const resizeSparse = (size) => {
      assert.ok(record.sparse?.created);
      assert.equal(
        realpathSync(dirname(record.sparse.path)),
        realpathSync(sourcePath),
      );
      const before = lstatSync(record.sparse.path);
      assert.equal(before.isFile() && !before.isSymbolicLink(), true);
      assert.equal(before.dev, record.sparse.dev);
      assert.equal(before.ino, record.sparse.ino);
      const fd = openSync(record.sparse.path, "r+");
      try {
        const opened = fstatSync(fd);
        assert.equal(opened.dev, record.sparse.dev);
        assert.equal(opened.ino, record.sparse.ino);
        ftruncateSync(fd, size);
      } finally {
        closeSync(fd);
      }
      const after = statSync(record.sparse.path);
      assert.equal(after.size, size);
      assert.ok(
        after.blocks * 512 <= 65536,
        "A logical guard fixture must occupy at most 64 KiB of disk blocks.",
      );
      record.sparse.size = after.size;
      record.sparse.allocated = after.blocks * 512;
      saveRecord();
    };
    const removeSparse = () => {
      if (!record.sparse?.created || !existsSync(record.sparse.path)) return;
      const actual = lstatSync(record.sparse.path);
      assert.equal(actual.dev, record.sparse.dev);
      assert.equal(actual.ino, record.sparse.ino);
      assert.equal(actual.isFile() && !actual.isSymbolicLink(), true);
      rmSync(record.sparse.path);
      record.sparse.removed = true;
      saveRecord();
    };

    let failure;
    try {
      if (!restoreOnly) {
        assert.equal(existsSync(owned), false);
        const ownerParent = await location(parent, "parent");
        await api("locations", {
          action: "mkdir",
          purpose: "parent",
          parent: ownerParent.handle,
          name: basename(owned),
        });
        const ownedStat = lstatSync(owned);
        assert.equal(
          ownedStat.isDirectory() && !ownedStat.isSymbolicLink(),
          true,
        );
        record.ownedIdentity = { dev: ownedStat.dev, ino: ownedStat.ino };
        saveRecord();
        for (const name of ["Target", "Source"]) {
          const intended = {
            path: join(owned, `${name}.pond`),
            creationRequested: true,
          };
          record.libraries.push(intended);
          saveRecord();
          const info = await transition("library.createAt", {
            parent: (await location(owned, "parent")).handle,
            name,
          });
          assert.equal(info.path, intended.path);
          intended.id = readJson(join(info.path, "metadata.json")).id;
          saveRecord();
          await configureOwned(info.path);
        }
        const bytes = await sharp({
          create: { width: 96, height: 64, channels: 3, background: "#d23c32" },
        })
          .png()
          .toBuffer();
        const token = (
          await api("upload", bytes, { filename: "Copy fixture 水.png" })
        ).token;
        record.uploads.push({ token, removed: false });
        record.fixture = {
          title: `Copy storage ${randomUUID()}`,
          sourceId: `web-upload:${token.slice("iris-upload:".length)}`,
          sha256: digest(bytes),
          note: "Owned copy metadata survives across Libraries.",
          tag: `copy-${process.pid}`,
        };
        saveRecord();
        const created = await api("files", {
          name: "saves.createManual",
          params: {
            title: record.fixture.title,
            note: record.fixture.note,
            tags: [record.fixture.tag],
            filePaths: [token],
          },
        });
        assert.equal(created.ok, true);
        record.fixture.id = created.id;
        saveRecord();
        await waitUntil(async () => {
          const row = await query("saves.get", { id: created.id });
          return (
            row?.status === "complete" &&
            row.files.some((file) => file.kind === "image") &&
            row
          );
        }, "owned image imported");
        await api(`upload/${encodeURIComponent(token)}`, undefined, {
          method: "DELETE",
        });
        record.uploads[0].removed = true;
        saveRecord();
        await verifySource();

        const beforeCancel = tree(targetPath);
        const requestCursor = copyRequests;
        await copyAction();
        await clickText(`${picker} button`, "Cancel");
        await waitFor(
          "!document.querySelector('[aria-label=\"Host folders\"]')",
        );
        assert.equal(copyRequests, requestCursor);
        assert.deepEqual(tree(targetPath), beforeCancel);
        await prove("copy-cancel-no-write");

        const beforeCopy = await instance();
        let cursor = copies.length;
        await copyAction();
        await selectTarget(targetPath);
        let result = await copyReply(cursor);
        assert.equal(result.ok, true);
        assert.equal(result.imported, 1);
        assert.equal(result.skipped, 0);
        assert.equal(await instance(), beforeCopy);
        await waitFor(
          "document.body.textContent.includes('1 copied, 0 already in this library.')",
        );
        const copied = targetSave();
        assert.notEqual(copied.info.id, record.fixture.id);
        assert.equal(copied.info.title, record.fixture.title);
        assert.equal(copied.info.notes, record.fixture.note);
        assert.ok(copied.info.tags.includes(record.fixture.tag));
        assert.equal(
          digest(
            readFileSync(
              join(
                copied.directory,
                copied.info.files.find((file) => file.kind === "image").path,
              ),
            ),
          ),
          record.fixture.sha256,
          "The copied original must match the seeded image bytes.",
        );
        for (const file of copied.info.files) {
          const content = readFileSync(join(copied.directory, file.path));
          assert.equal(content.length, file.size);
          if (file.sha256) assert.equal(digest(content), file.sha256);
        }
        const copiedInfoHash = digest(
          readFileSync(join(copied.directory, "info.json")),
        );
        await verifySource();
        await prove("copy-real-picker-bytes-metadata-no-restart");

        cursor = copies.length;
        await copyAction();
        await selectTarget(targetPath);
        result = await copyReply(cursor);
        assert.equal(result.ok, true);
        assert.equal(result.imported, 0);
        assert.equal(result.skipped, 1);
        assert.equal(
          digest(readFileSync(join(targetSave().directory, "info.json"))),
          copiedInfoHash,
        );
        await waitFor(
          "document.body.textContent.includes('0 copied, 1 already in this library.')",
        );
        await prove("copy-repeat-deduplicates");

        cursor = copies.length;
        await copyAction();
        await selectTarget(sourcePath);
        result = await copyReply(cursor);
        assert.equal(result.ok, false);
        assert.match(result.error, /different library/i);
        await waitFor(
          "document.body.textContent.includes('Choose a different library.')",
        );
        await verifySource();
        await prove("copy-active-target-rejected");

        await openLibrary(targetPath);
        await assertOwnedLibrary(targetPath);
        const rows = await waitUntil(async () => {
          const page = await query("saves.listPage", { limit: 10 });
          return (
            page.rows.some((row) => row.sourceId === record.fixture.sourceId) &&
            page.rows
          );
        }, "copied Save positively hydrated after actual host restart");
        assert.equal(rows.length, 1);
        assert.equal(rows[0].id, copied.info.id);
        assert.equal(rows[0].notes, record.fixture.note);
        await waitFor(
          `document.querySelector('[data-save-id="${rows[0].id}"]')`,
        );
        await click(`[data-save-id="${rows[0].id}"] [role="option"]`, 2);
        await waitFor(
          `Array.from(document.querySelectorAll('[data-save-details] img')).some(image=>new URL(image.src).pathname.includes('/web/media/${rows[0].id}/') && image.complete && image.naturalWidth>0)`,
        );
        await prove("copy-destination-open-index-and-real-viewer");
        await openLibrary(sourcePath);
        await verifySource();

        await assertOwnedLibrary(sourcePath);
        record.sparse = {
          path: join(sourcePath, `.__circe-storage-${randomUUID()}`),
          created: false,
        };
        saveRecord();
        const fd = openSync(record.sparse.path, "wx", 0o600);
        try {
          const stat = fstatSync(fd);
          record.sparse = {
            ...record.sparse,
            created: true,
            dev: stat.dev,
            ino: stat.ino,
          };
          saveRecord();
        } finally {
          closeSync(fd);
        }
        resizeSparse(8 * 1024 ** 2);
        resizeSparse(7.5 * gib);
        await waitUntil(
          async () => (await query("storage.snapshot")).pondBytes >= 7.5 * gib,
          "real sparse-fixture storage snapshot",
          45000,
        );
        await storageScreen();
        await waitFor(
          "document.body.textContent.includes('used ·') && document.body.textContent.includes('available on disk')",
        );
        await switchLimit(true);
        await selectSetting("Size Limit", "10 GB", "maxLibraryGb", 10);
        const warningEventCursor = record.storageEvents.length;
        await selectSetting("Warn At", "70%", "warnAtPercent", 70);
        await waitUntil(
          async () => (await query("storage.guardState")).state === "warn",
          "native warning threshold",
        );
        await waitFor(
          "document.body.textContent.includes('Library is approaching its size limit')",
        );
        assert.ok(
          record.storageEvents
            .slice(warningEventCursor)
            .some(
              ({ status }) =>
                status.state === "warn" &&
                status.capBytes === 10 * gib &&
                status.action === "warn",
            ),
          "The real control change must arrive through the current browser SSE connection.",
        );
        await prove("storage-real-controls-warning-and-sse");

        await selectSetting("Size Limit", "No Limit", "maxLibraryGb", null);
        await waitUntil(
          async () => (await query("storage.guardState")).state === "ok",
          "No Limit clears the warning",
        );
        resizeSparse(11 * gib);
        await waitUntil(
          async () => (await query("storage.snapshot")).pondBytes >= 11 * gib,
          "real snapshot-cache expiry measures grown sparse file",
          45000,
        );
        await selectSetting("Size Limit", "10 GB", "maxLibraryGb", 10);
        await waitFor(
          "document.body.textContent.includes('Library size limit reached')",
        );
        await selectSetting(
          "When the Limit Is Reached",
          "Pause Fetching",
          "action",
          "pauseSync",
        );
        await waitFor(
          "document.body.textContent.includes('Fetching is paused. Increase the limit or free space to resume.')",
        );
        await waitUntil(async () => {
          const state = await query("storage.guardState");
          return state.state === "exceeded" && state.action === "pauseSync";
        }, "real pause-fetching status");
        await selectSetting(
          "When the Limit Is Reached",
          "Pause Video Downloads",
          "action",
          "pauseVideo",
        );
        await waitFor(
          "document.body.textContent.includes('Automatic video downloads are paused.')",
        );
        await waitUntil(async () => {
          const state = await query("storage.guardState");
          return state.state === "exceeded" && state.action === "pauseVideo";
        }, "real pause-video status");
        await prove("storage-exceeded-action-statuses");

        await selectSetting("Size Limit", "No Limit", "maxLibraryGb", null);
        await waitUntil(async () => {
          const state = await query("storage.guardState");
          return state.state === "ok" && state.capBytes === null;
        }, "No Limit releases both guard actions");
        removeSparse();
        await win.loadURL(`${origin}/settings/storage`);
        const persisted = (await query("settings.getPrefs")).storage;
        assert.equal(persisted.guardsEnabled, true);
        assert.equal(persisted.maxLibraryGb, null);
        assert.equal(persisted.warnAtPercent, 70);
        assert.equal(persisted.action, "pauseVideo");
        const sizeField = await field(
          '[role="combobox"],button[aria-haspopup="listbox"]',
          "Size Limit",
        );
        await waitFor(
          `document.querySelector(${JSON.stringify(sizeField)})?.innerText.includes('No Limit')`,
        );
        await switchLimit(false);
        await waitUntil(async () => {
          const state = await query("storage.guardState");
          return state.state === "ok" && state.capBytes === null;
        }, "Disable releases storage guards");
        await prove("storage-no-limit-disable-reload-persistence");
      }
    } catch (error) {
      failure = error;
      record.menuInputEvents = await run(
        "window.__copyStorageEvents??[]",
      ).catch(() => []);
      record.failure = {
        message: error.message,
        stack: error.stack,
        phase: record.uiPhase,
      };
      saveRecord();
      await snapshot("copy-storage-failed").catch(() => {});
    } finally {
      restoring = true;
      try {
        removeSparse();
        await connect();
        const current = await query("library.info");
        const known = record.libraries.find(
          (entry) => entry.path === current.path,
        );
        if (known?.prefs) {
          await assertOwnedLibrary(current.path);
          await query("settings.setPrefs", {
            storage: known.prefs.storage,
            ai: known.prefs.ai,
          });
        }
        if (record.uploads.some((upload) => !upload.removed)) {
          assert.ok(
            record.libraries.some(
              (entry) => entry.path === sourcePath && entry.id,
            ),
          );
          if (current.path !== sourcePath) await openLibrary(sourcePath);
          await assertOwnedLibrary(sourcePath);
          for (const upload of record.uploads)
            if (!upload.removed) {
              await api(
                `upload/${encodeURIComponent(upload.token)}`,
                undefined,
                { method: "DELETE" },
              );
              upload.removed = true;
              saveRecord();
            }
        }
        if ((await query("library.info")).path !== original.path)
          await openLibrary(original.path);
        const final = await query("library.info");
        assert.equal(final.path, original.path);
        assert.equal(
          readJson(join(final.path, "metadata.json")).id,
          originalId,
        );
        for (const key of ["name", "icon", "mark", "accent"])
          assert.deepEqual(final[key], original[key]);
        const prefs = await query("settings.getPrefs");
        assert.deepEqual(
          prefs,
          originalPrefs,
          "All original Library and app preferences must survive the fixture workflow.",
        );
        if (pointer) assert.equal(readJson(pointer).path, original.path);
        record.restored = true;
        saveRecord();
        assert.equal(dirname(owned), parent);
        assert.match(basename(owned), /^Circe copy storage \d+-\d+$/);
        assert.equal(original.path.startsWith(`${owned}${sep}`), false);
        if (existsSync(owned)) {
          const actual = lstatSync(owned);
          assert.ok(record.ownedIdentity);
          assert.equal(actual.isDirectory() && !actual.isSymbolicLink(), true);
          assert.equal(actual.dev, record.ownedIdentity.dev);
          assert.equal(actual.ino, record.ownedIdentity.ino);
          for (const name of readdirSync(owned))
            assert.ok(
              ["Source.pond", "Target.pond"].includes(name),
              "Only known fixture Libraries may be removed.",
            );
          for (const library of record.libraries) {
            assert.ok([sourcePath, targetPath].includes(library.path));
            if (existsSync(join(library.path, "metadata.json"))) {
              const id = readJson(join(library.path, "metadata.json")).id;
              assert.notEqual(id, originalId);
              if (library.id) assert.equal(id, library.id);
            }
          }
        }
        for (const library of record.libraries)
          await query("library.recent.remove", { path: library.path });
        rmSync(owned, { recursive: true, force: true });
        record.cleaned = !existsSync(owned);
        await snapshot("copy-storage-original-restored");
      } catch (error) {
        record.restoreError = error.message;
        failure = failure
          ? new AggregateError(
              [failure, error],
              "Copy/storage recovery needs attention.",
            )
          : error;
      } finally {
        saveRecord();
        debuggerApi.removeListener("message", network);
        if (debuggerApi.isAttached()) debuggerApi.detach();
      }
    }
    assert.equal(record.restored && record.cleaned, true);
    if (failure) throw failure;
    console.log(
      restoreOnly ? "WEB_COPY_STORAGE_RESTORED" : "WEB_COPY_STORAGE_PASSED",
      JSON.stringify({
        checks: record.checks,
        restored: record.restored,
        cleaned: record.cleaned,
        record: recordPath,
      }),
    );
  };
