const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
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
const { isDeepStrictEqual } = require("node:util");
const sharp = require("sharp");

const picker = '[data-maintenance-picker="true"]';
const repair = '[data-maintenance-repair="true"]';
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

exports.verifyBrowserHostMaintenance =
  async function verifyBrowserHostMaintenance({
    win,
    run,
    click: clickControl,
    waitFor,
    snapshot,
    query,
    origin,
    evidence,
    sandbox,
    refreshSession,
  }) {
    const recoveryOnly = process.argv.includes("--host-maintenance-restore");
    const chooserOnly = process.argv.includes("--maintenance-chooser");
    const recordPath = join(evidence, "host-maintenance-restore.json");
    const saved = recoveryOnly ? readJson(recordPath) : null;
    const initial = saved?.original ?? (await query("library.info"));
    const originalPrefs =
      saved?.originalPrefs ?? (await query("settings.getPrefs"));
    assert.equal(
      originalPrefs.autoImport.enabled,
      false,
      "Maintenance smoke requires the original watched folder to be disabled.",
    );
    const originalId = readJson(join(initial.path, "metadata.json")).id;
    const parent = dirname(resolve(initial.path));
    const owned =
      saved?.owned ??
      join(parent, `Circe host maintenance ${process.pid}-${Date.now()}`);
    const activePath = join(owned, "Maintenance.pond");
    const emptyPath = join(owned, "Empty.pond");
    const watchPath = join(owned, "Incoming");
    const pointerPath = [
      join(sandbox, "app-data", "library-location.json"),
      join(sandbox, "library-location.json"),
    ].find(existsSync);
    if (!recoveryOnly) assert.equal(existsSync(owned), false);
    const record = saved ?? {
      original: { ...initial, libraryId: originalId },
      originalAutoImport: originalPrefs.autoImport,
      originalPrefs,
      owned,
      activePath,
      emptyPath,
      watchPath,
      checks: {},
      createdLibraries: [],
      restored: false,
      cleaned: false,
    };
    const saveRecord = () => {
      writeFileSync(recordPath, JSON.stringify(record, null, 2), {
        mode: 0o600,
      });
      chmodSync(recordPath, 0o600);
    };
    const checked = (name) => {
      record.checks[name] = true;
      saveRecord();
    };
    saveRecord();
    const phase = (label) => {
      record.uiPhase = label;
      record.uiPhaseAt = Date.now();
      saveRecord();
    };
    const click = async (selector, count = 1) => {
      phase(`Click: ${selector}`);
      await clickControl(selector, count);
      phase(`Clicked: ${selector}`);
    };

    const waitUntil = async (read, label, timeout = 30000) => {
      const deadline = Date.now() + timeout;
      let cause;
      while (Date.now() < deadline) {
        try {
          const value = await read();
          if (value) return value;
        } catch (error) {
          cause = error;
        }
        await pause(100);
      }
      throw new Error(`Host maintenance timed out: ${label}`, { cause });
    };
    const key = (keyCode, modifiers = []) => {
      win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    };
    const mark = async (selector, predicate) => {
      phase(`Find: ${selector} ${predicate}`);
      await waitFor(
        `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(node => node.getBoundingClientRect().width > 0 && (${predicate}))`,
      );
      await run(`(() => {
      document.querySelectorAll('[data-maintenance-control]').forEach(node => node.removeAttribute('data-maintenance-control'));
      const node = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node => node.getBoundingClientRect().width > 0 && (${predicate}));
      node.setAttribute('data-maintenance-control','target');
    })()`);
      return '[data-maintenance-control="target"]';
    };
    const text = (selector, label) =>
      mark(selector, `node.textContent.trim() === ${JSON.stringify(label)}`);
    const clickText = async (selector, label) =>
      click(await text(selector, label));
    const replaceInput = async (selector, value) => {
      phase(`Edit: ${selector}`);
      await run(`(() => {
        const trace=[];
        const headings=()=>Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]')).map(node=>node.querySelector('h2,[role="heading"]')?.textContent?.trim() || node.getAttribute('aria-label'));
        const listener=event=>{
          trace.push({type:event.type,trusted:event.isTrusted,time:performance.now(),target:event.target?.getAttribute?.('aria-label') || event.target?.tagName,dialogs:headings()});
          if(trace.length>50)trace.shift();
        };
        const events=['focusin','focusout','mousedown','mouseup','click','keydown'];
        for(const event of events)document.addEventListener(event,listener,true);
        window.__maintenanceInputTrace={trace,stop:()=>{for(const event of events)document.removeEventListener(event,listener,true)}};
      })()`);
      try {
        await click(selector);
        const immediate = await run(`(() => {
          const node=document.querySelector(${JSON.stringify(selector)});
          return {selector:${JSON.stringify(selector)},hasFocus:document.hasFocus(),fieldExists:Boolean(node),active:document.activeElement===node,activeElement:document.activeElement?.outerHTML.slice(0,600),dialogs:Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]')).map(dialog=>({title:dialog.querySelector('h2,[role="heading"]')?.textContent?.trim(),html:dialog.outerHTML.slice(0,600)}))};
        })()`);
        if (!immediate.active) {
          record.immediateInputFocus = immediate;
          saveRecord();
          await snapshot("host-maintenance-immediate-focus");
        }
        await waitFor(
          `document.activeElement === document.querySelector(${JSON.stringify(selector)})`,
        );
        win.webContents.selectAll();
        await win.webContents.insertText(value);
        await waitFor(
          `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`,
        );
      } catch (error) {
        record.inputFocusTrace = await run(
          "window.__maintenanceInputTrace?.trace ?? []",
        ).catch(() => []);
        saveRecord();
        throw error;
      } finally {
        await run(
          "window.__maintenanceInputTrace?.stop();delete window.__maintenanceInputTrace",
        ).catch(() => {});
      }
    };
    const instance = async () => {
      const response = await fetch(`${origin}/web/ready`, {
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      assert.equal(response.status, 200);
      return (await response.json()).instance;
    };
    async function api(route, body, { filename, allowFailure = false } = {}) {
      const cookies = await win.webContents.session.cookies.get({
        url: origin,
        name: "iris_session",
      });
      assert.equal(
        cookies.length,
        1,
        "Maintenance setup needs one authenticated host session.",
      );
      const cookie = `iris_session=${cookies[0].value}`;
      const session = await fetch(`${origin}/web/session`, {
        headers: { cookie },
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(
        session.status,
        200,
        "Maintenance setup session must be valid.",
      );
      const { libraryId } = await session.json();
      const headers = {
        cookie,
        origin,
        "x-iris-library": libraryId,
        "content-type": filename
          ? "application/octet-stream"
          : "application/json",
      };
      if (filename) headers["x-iris-filename"] = encodeURIComponent(filename);
      const response = await fetch(`${origin}/web/${route}`, {
        method: filename ? "PUT" : "POST",
        headers,
        body: filename
          ? body
          : body === undefined
            ? undefined
            : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if (!allowFailure)
        assert.equal(
          response.status,
          200,
          `Maintenance ${route} request must succeed.`,
        );
      return { status: response.status, result };
    }
    async function location(path, purpose) {
      const roots = (await api("locations", { action: "list", purpose })).result
        .entries;
      const root = roots
        .filter(
          (entry) =>
            resolve(path) === entry.path ||
            resolve(path).startsWith(`${entry.path}${sep}`),
        )
        .sort((a, b) => b.path.length - a.path.length)[0];
      assert.ok(
        root,
        "Fixture path must belong to an advertised host location.",
      );
      let entry = root;
      for (const name of relative(root.path, resolve(path))
        .split(sep)
        .filter(Boolean)) {
        const listing = (
          await api("locations", {
            action: "list",
            purpose,
            handle: entry.handle,
            filter: name,
            hidden: true,
          })
        ).result;
        entry = listing.entries.find((candidate) => candidate.name === name);
        assert.ok(entry, "The owned fixture location must be listed.");
      }
      return entry;
    }

    const debuggerApi = win.webContents.debugger;
    debuggerApi.attach("1.3");
    await debuggerApi.sendCommand("Page.enable");
    await debuggerApi.sendCommand("Network.enable");
    await debuggerApi.sendCommand("Page.setInterceptFileChooserDialog", {
      enabled: true,
    });
    const requests = new Map();
    const replies = [];
    record.navigationEvents ??= [];
    record.sseEvents ??= [];
    const onNavigation = (details) => {
      if (!details.isMainFrame) return;
      record.navigationEvents.push({
        at: Date.now(),
        path: new URL(details.url).pathname,
        sameDocument: details.isSameDocument,
        phase: record.uiPhase,
      });
      saveRecord();
    };
    win.webContents.on("did-start-navigation", onNavigation);
    const network = (_event, method, params) => {
      if (method === "Network.eventSourceMessageReceived") {
        record.sseEvents.push({
          at: Date.now(),
          name: params.eventName,
          requestId: params.requestId,
        });
        if (record.sseEvents.length > 200) record.sseEvents.shift();
        saveRecord();
      }
      if (
        method === "Network.requestWillBeSent" &&
        params.request.url === `${origin}/web/query` &&
        params.request.postData
      ) {
        const request = JSON.parse(params.request.postData);
        if (request.name.startsWith("libraryRepairs."))
          requests.set(params.requestId, request.name);
      }
      if (
        method !== "Network.loadingFinished" ||
        !requests.has(params.requestId)
      )
        return;
      const name = requests.get(params.requestId);
      requests.delete(params.requestId);
      void debuggerApi
        .sendCommand("Network.getResponseBody", { requestId: params.requestId })
        .then(({ body, base64Encoded }) => {
          replies.push({
            name,
            result: JSON.parse(
              base64Encoded ? Buffer.from(body, "base64").toString() : body,
            ),
          });
        })
        .catch(() => {});
    };
    debuggerApi.on("message", network);
    const pickKeyFile = async () => {
      let listener;
      let timer;
      const opened = new Promise((resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("Maintenance access-key chooser did not open.")),
          15000,
        );
        listener = (_event, method, params) => {
          if (method === "Page.fileChooserOpened") resolve(params);
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
    };
    const connect = async (previous) => {
      if (previous)
        await waitUntil(
          async () => (await instance()) !== previous,
          "replacement host",
          60000,
        );
      await win.loadURL(origin);
      const login = "Boolean(document.querySelector('#host-key-file'))";
      const ready =
        "Boolean(document.querySelector('#fixture-kind, [data-slot=\"window\"], [data-library-search]'))";
      await waitUntil(
        () => run(`(${login}) || (${ready})`),
        "login or authenticated application",
        60000,
      );
      if (await run(login)) {
        await pickKeyFile();
        await waitUntil(() => run(ready), "real access-key file login", 60000);
      }
      await refreshSession({ allowLibraryChange: true });
      const current = await query("library.info");
      return {
        ...current,
        libraryId: readJson(join(current.path, "metadata.json")).id,
      };
    };
    async function setupTransition(name, params) {
      const previous = await instance();
      const started = Date.now();
      const result = (await api("library", { name, params })).result;
      assert.equal(result.ok, true, "Fixture Library setup must succeed.");
      const timing = { name, requestMs: Date.now() - started };
      record.transitions ??= [];
      record.transitions.push(timing);
      saveRecord();
      const next = await connect(result.restarting ? previous : undefined);
      timing.reconnectedMs = Date.now() - started;
      saveRecord();
      return next;
    }
    async function switchSetup(path) {
      const source = await location(path, "open");
      return setupTransition("library.switchTo", { source: source.handle });
    }
    const sidebar = async () => {
      await waitFor(
        "document.querySelector('[aria-label=\"Toggle Sidebar\"]')",
      );
      if (
        !(await run(
          "document.querySelector('[data-slot=\"window\"]')?.hasAttribute('data-left-open')",
        ))
      )
        await click('[aria-label="Toggle Sidebar"]');
    };
    const navigateSidebar = async (label, path) => {
      await sidebar();
      await click(
        await mark(
          '[role="navigation"][aria-label="Library"] button',
          `Array.from(node.querySelectorAll('span')).some(label => label.textContent.trim() === ${JSON.stringify(label)})`,
        ),
      );
      await waitFor(`location.pathname === ${JSON.stringify(path)}`);
    };
    const libraryScreen = async () => {
      await sidebar();
      if (
        await run(
          "Array.from(document.querySelectorAll('button')).some(node => node.textContent.trim() === 'Exit settings')",
        )
      )
        await clickText("button", "Exit settings");
      await navigateSidebar("All", "/");
      await waitFor("document.querySelector('[aria-label=\"New\"]')");
    };
    const newAction = async (label) => {
      await libraryScreen();
      await click('[aria-label="New"]');
      await waitFor(
        "document.querySelector('[aria-label=\"Search Actions\"]')",
      );
      await replaceInput('[aria-label="Search Actions"]', label);
      await click(
        await mark(
          '[role="menuitem"]',
          `node.querySelector('[data-menu-breadcrumb-current]')?.textContent === ${JSON.stringify(label)} || node.textContent.trim() === ${JSON.stringify(label)}`,
        ),
      );
    };
    const libraryAction = async (label) => {
      await libraryScreen();
      await click('[aria-label="Library Menu"]');
      await clickText('[role="menuitem"]', "Switch Library");
      await clickText('[role="menuitem"]', label);
    };
    const tagPicker = async () => {
      await waitFor(
        'document.querySelector(\'[role="dialog"] [aria-label="Host folders"]\')',
      );
      await run(`(() => {
      document.querySelectorAll('[data-maintenance-picker]').forEach(node => node.removeAttribute('data-maintenance-picker'));
      document.querySelector('[aria-label="Host folders"]').closest('[role="dialog"]').setAttribute('data-maintenance-picker','true');
    })()`);
      await waitFor(
        `document.querySelector(${JSON.stringify(`${picker} [aria-label="Host folders"]`)})?.getAttribute('aria-busy') === 'false'`,
      );
    };
    const atDirectory = (path) =>
      waitFor(
        `Array.from(document.querySelectorAll(${JSON.stringify(`${picker} [title]`)})).some(node => node.title === ${JSON.stringify(path)}) && document.querySelector(${JSON.stringify(`${picker} [aria-label="Host folders"]`)})?.getAttribute('aria-busy') === 'false'`,
      );
    const rootFolder = async () => {
      await tagPicker();
      await click(
        await mark(
          `${picker} [role="option"]`,
          "node.querySelector('span')?.textContent === 'Library folders'",
        ),
        2,
      );
      await atDirectory(owned);
    };
    const selectLibraryUi = async (path) => {
      await rootFolder();
      await replaceInput(
        `${picker} [aria-label="Filter host folders"]`,
        basename(path),
      );
      await click(
        await mark(
          `${picker} [role="option"]`,
          `node.querySelector('span')?.textContent === ${JSON.stringify(basename(path))}`,
        ),
      );
      await clickText(`${picker} button`, "Open");
      await waitFor("!document.querySelector('[aria-label=\"Host folders\"]')");
    };
    const addWatchedFolder = async () => {
      await navigateSidebar("Sources", "/sources");
      await waitFor("document.querySelector('[data-sources-new]')");
      await click("[data-sources-new]");
      await clickText('[role="menuitem"]', "New Folder");
      await tagPicker();
    };
    const folderMenu = async (label) => {
      await navigateSidebar("Sources", "/sources");
      await waitFor(
        'document.querySelector(\'[role="grid"][aria-label="Sources"]\')',
      );
      const row = await mark(
        '[role="grid"][aria-label="Sources"] [role="row"][aria-selected]',
        "node.textContent.includes('Incoming')",
      );
      const point = await run(
        `(() => { const r=document.querySelector(${JSON.stringify(row)}).getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`,
      );
      win.webContents.sendInputEvent({ type: "mouseMove", ...point });
      win.webContents.sendInputEvent({
        type: "mouseDown",
        button: "right",
        clickCount: 1,
        ...point,
      });
      win.webContents.sendInputEvent({
        type: "mouseUp",
        button: "right",
        clickCount: 1,
        ...point,
      });
      await clickText('[role="menuitem"]', label);
    };
    const status = () => query("autoImport.status");
    const allSaves = async () =>
      (await query("saves.listPage", { limit: 100 })).rows;
    const png = async (index) =>
      sharp({
        create: {
          width: 64,
          height: 48,
          channels: 3,
          background: { r: 20 + index * 17, g: 85, b: 120 },
        },
      })
        .png()
        .toBuffer();
    const assertOriginal = (row) => {
      const file = row.files.find(
        (file) => file.sha256 && !/thumbnail/.test(file.kind),
      );
      assert.ok(file);
      const bytes = readFileSync(
        join(activePath, "items", `${row.id}.info`, file.path),
      );
      assert.equal(bytes.byteLength, file.size);
      assert.equal(digest(bytes), file.sha256);
      return file;
    };
    const imported = async (name, bytes) =>
      waitUntil(async () => {
        const current = await status();
        const completed = current.history.filter(
          (entry) => entry.ok && entry.name === name,
        );
        if (!completed.length) return false;
        assert.equal(
          completed.length,
          1,
          "Checkpointed content must not import twice.",
        );
        const row = await query("saves.get", { id: completed[0].id });
        if (row?.status !== "complete") return false;
        assert.equal(assertOriginal(row).sha256, digest(bytes));
        const checkpoints = readJson(
          join(activePath, "auto-import-checkpoints.json"),
        );
        assert.equal(checkpoints[join(watchPath, name)], digest(bytes));
        return row;
      }, `durable watched import ${name}`);
    const drop = async (name, index, { move = false, stable = false } = {}) => {
      const bytes = await png(index);
      const path = join(watchPath, name);
      writeFileSync(path, bytes);
      if (stable) {
        await pause(1100);
        assert.equal(
          (await status()).history.some(
            (entry) => entry.ok && entry.name === name,
          ),
          false,
          "A fresh file must be observed stable before importing.",
        );
      }
      const row = await imported(name, bytes);
      if (move)
        await waitUntil(
          () => !existsSync(path),
          "Move removes only the successfully imported owned source",
        );
      else assert.equal(digest(readFileSync(path)), digest(bytes));
      return row;
    };
    const seedImage = async () => {
      const bytes = await png(8);
      const token = (
        await api("upload", bytes, {
          filename: "maintenance-repair.png",
        })
      ).result.token;
      const result = (
        await api("files", {
          name: "saves.createManual",
          params: { title: "Maintenance repair fixture", filePaths: [token] },
        })
      ).result;
      assert.equal(result.ok, true);
      return waitUntil(async () => {
        const row = await query("saves.get", { id: result.id });
        return row?.status === "complete" &&
          row.files.some((file) => /thumbnail/.test(file.kind))
          ? row
          : false;
      }, "owned repair image and thumbnail");
    };
    const openRepair = async (label, kind, saveId) => {
      const after = replies.length;
      await newAction(label);
      await waitFor(
        `Array.from(document.querySelectorAll('[role="dialog"]')).some(node => node.querySelector('h2,[role="heading"]')?.textContent.trim() === ${JSON.stringify(label)})`,
      );
      await run(
        `Array.from(document.querySelectorAll('[role="dialog"]')).find(node => node.querySelector('h2,[role="heading"]')?.textContent.trim() === ${JSON.stringify(label)}).setAttribute('data-maintenance-repair','true')`,
      );
      await waitFor(
        `document.querySelector(${JSON.stringify(repair)})?.textContent.includes('Save needs repair.')`,
      );
      const job = await waitUntil(
        () =>
          replies
            .slice(after)
            .map((reply) => reply.result)
            .find(
              (job) =>
                job.phase === "preview" &&
                job.kind === kind &&
                job.status === "completed" &&
                job.preview,
            ),
        "the actual UI preview response",
      );
      assert.equal(job.preview.issues.length, 1);
      assert.equal(job.preview.issues[0].saveId, saveId);
      return job;
    };
    const applyRepair = async (kind, canUndo) => {
      assert.equal(
        await run(
          `document.querySelector(${JSON.stringify(repair)}).textContent.includes(${JSON.stringify(canUndo ? "You can undo this repair." : "You can't undo this repair.")})`,
        ),
        true,
      );
      const after = replies.length;
      await clickText(`${repair} button`, "Repair");
      await waitFor(
        `document.querySelector(${JSON.stringify(repair)})?.textContent.includes('Repaired 1 Save.')`,
      );
      const job = await waitUntil(
        () =>
          replies
            .slice(after)
            .map((reply) => reply.result)
            .find(
              (job) =>
                job.phase === "apply" &&
                job.kind === kind &&
                job.status === "completed",
            ),
        "completed UI repair job",
      );
      assert.deepEqual(job.result, {
        repaired: 1,
        skipped: 0,
        undoRecorded: canUndo,
      });
      await clickText(`${repair} button`, "Close");
      await waitFor(`!document.querySelector(${JSON.stringify(repair)})`);
    };
    const undo = async (verify) => {
      await click('[data-slot="center"]');
      assert.equal(
        await run(
          "document.activeElement?.matches('input,textarea,[contenteditable=true]')",
        ),
        false,
      );
      key("Z", process.platform === "darwin" ? ["meta"] : ["control"]);
      await waitUntil(verify, "real browser keyboard Undo", 10000);
    };

    let failure;
    let activated = recoveryOnly;
    try {
      if (!recoveryOnly) {
        if (originalPrefs.autoImport.path) {
          const paused = await location(originalPrefs.autoImport.path, "watch");
          assert.equal(
            paused.path,
            originalPrefs.autoImport.path,
            "A paused original folder must still have a canonical grant before this probe changes its preferences.",
          );
        }
        const parentEntry = await location(parent, "parent");
        const ownedEntry = (
          await api("locations", {
            action: "mkdir",
            purpose: "parent",
            parent: parentEntry.handle,
            name: basename(owned),
          })
        ).result;
        const empty = await setupTransition("library.createAt", {
          parent: ownedEntry.handle,
          name: "Empty",
        });
        assert.equal(empty.path, emptyPath);
        record.createdLibraries.push(emptyPath);
        saveRecord();
        const nextParent = await location(owned, "parent");
        const active = await setupTransition("library.createAt", {
          parent: nextParent.handle,
          name: "Maintenance",
        });
        activated = true;
        record.createdLibraries.push(activePath);
        record.activeId = active.libraryId;
        assert.equal(active.path, activePath);
        assert.notEqual(active.libraryId, originalId);
        await query("settings.setPrefs", {
          ai: {
            semanticSearch: false,
            enableCaption: false,
            enableOcr: false,
            enableTranscript: false,
            enableClip: false,
            enableSensitiveContent: false,
            enableAesthetic: false,
            enableAutoTitle: false,
            enableSuggestedTags: false,
          },
        });

        if (chooserOnly) {
          const previous = await instance();
          await libraryAction("Open Library");
          await selectLibraryUi(activePath);
          assert.equal(await instance(), previous);
          record.activeOpenFinishedAt = Date.now();
          await libraryAction("Merge Library");
          await rootFolder();
          const before = await run("performance.timeOrigin");
          record.chooserOpen = { at: Date.now(), timeOrigin: before };
          saveRecord();
          await pause(4000);
          const after = await run(
            "({timeOrigin:performance.timeOrigin,picker:Boolean(document.querySelector('[aria-label=\"Host folders\"]')),dialogs:Array.from(document.querySelectorAll('[role=dialog]')).map(node=>node.querySelector('h2,[role=heading]')?.textContent?.trim())})",
          );
          record.chooserAfterDwell = { at: Date.now(), ...after };
          saveRecord();
          assert.equal(
            after.timeOrigin,
            before,
            "An active-Library Open must not reload and discard the next chooser.",
          );
          assert.equal(
            after.picker,
            true,
            "The real Merge chooser must retain its user-owned interaction.",
          );
          await clickText(`${picker} button`, "Cancel");
          checked("activeOpenPreservesNextChooser");
        } else {
          const initialWatch = await status();
          const beforeCancel = readdirSync(owned).sort();
          await addWatchedFolder();
          await clickText(`${picker} button`, "Cancel");
          await waitFor(
            "!document.querySelector('[aria-label=\"Host folders\"]')",
          );
          assert.deepEqual(readdirSync(owned).sort(), beforeCancel);
          assert.deepEqual(await status(), initialWatch);
          checked("watchChooserCancel");

          await addWatchedFolder();
          await rootFolder();
          await clickText(`${picker} button`, "New folder");
          await replaceInput(
            `${picker} [aria-label="New host folder name"]`,
            "Incoming",
          );
          await clickText(`${picker} form button`, "Create folder");
          await atDirectory(watchPath);
          await clickText(`${picker} button`, "Select folder");
          await waitUntil(async () => {
            const cfg = await status();
            return cfg.enabled && cfg.path === watchPath;
          }, "the actual selected host watcher");
          await api("watched-folder", {
            name: "autoImport.set",
            params: { mode: "copy" },
          });
          await drop("copy.png", 1, { stable: true });
          const checkpoint = readFileSync(
            join(activePath, "auto-import-checkpoints.json"),
          );
          await pause(2500);
          assert.deepEqual(
            readFileSync(join(activePath, "auto-import-checkpoints.json")),
            checkpoint,
          );
          checked("stableCopyAndCheckpoint");
          await snapshot("host-maintenance-watched-copy");

          await folderMenu("Pause Watching");
          await waitUntil(
            async () => !(await status()).enabled,
            "Pause Watching control",
          );
          const pausedBytes = await png(2);
          writeFileSync(join(watchPath, "paused.png"), pausedBytes);
          await pause(3000);
          assert.equal(
            (await status()).history.some(
              (entry) => entry.ok && entry.name === "paused.png",
            ),
            false,
          );
          assert.equal(existsSync(join(watchPath, "paused.png")), true);
          await folderMenu("Resume Watching");
          await imported("paused.png", pausedBytes);
          assert.equal(
            (await status()).history.filter(
              (entry) => entry.ok && entry.name === "copy.png",
            ).length,
            1,
          );
          checked("pauseResumeNoDuplicates");

          // Mode is setup through the real scoped controller; only files created by this probe can be moved.
          rmSync(join(watchPath, "copy.png"));
          rmSync(join(watchPath, "paused.png"));
          await api("watched-folder", {
            name: "autoImport.set",
            params: { mode: "move" },
          });
          await drop("move.png", 3, { move: true });
          checked("moveAfterDurableImport");

          const beforeNoop = await instance();
          await libraryAction("Open Library");
          await selectLibraryUi(activePath);
          assert.equal(await instance(), beforeNoop);
          await drop("after-active-open.png", 4, { move: true });
          checked("enabledWatchSurvivesActiveOpen");
          await libraryAction("Merge Library");
          await selectLibraryUi(emptyPath);
          await waitFor(
            "document.body.textContent.includes('Imported 0 Saves. Skipped 0.')",
          );
          assert.equal(await instance(), beforeNoop);
          await drop("after-merge.png", 5, { move: true });
          checked("enabledWatchSurvivesMerge");

          const countBeforeStop = (await allSaves()).length;
          await folderMenu("Stop Watching");
          await clickText('[role="alertdialog"] button', "Stop");
          await waitUntil(async () => {
            const cfg = await status();
            return !cfg.enabled && cfg.path === "";
          }, "Stop Watching clears active configuration");
          const stoppedBytes = await png(6);
          writeFileSync(join(watchPath, "after-stop.png"), stoppedBytes);
          await pause(2500);
          assert.equal((await allSaves()).length, countBeforeStop);
          assert.equal(
            digest(readFileSync(join(watchPath, "after-stop.png"))),
            digest(stoppedBytes),
          );
          checked("stopPreservesSavesAndSource");

          const stale = await location(watchPath, "watch");
          renameSync(watchPath, `${watchPath} Previous`);
          mkdirSync(watchPath);
          const rejected = await api(
            "watched-folder",
            { name: "autoImport.pickFolder", params: { folder: stale.handle } },
            { allowFailure: true },
          );
          assert.equal(rejected.status, 422);
          assert.equal((await status()).enabled, false);
          checked("replacedFolderGrantRejected");

          let row = await seedImage();
          const directory = join(activePath, "items", `${row.id}.info`);
          const infoPath = join(directory, "info.json");
          const rescanTitle = `Rescanned maintenance ${process.pid}`;
          const external = readJson(infoPath);
          external.title = rescanTitle;
          writeFileSync(infoPath, JSON.stringify(external));
          await newAction("Rescan Library");
          row = await waitUntil(async () => {
            const next = await query("saves.get", { id: row.id });
            return next.title === rescanTitle ? next : false;
          }, "actual New → Rescan Library updates the index");
          await click(`[data-save-id="${row.id}"] [role="option"]`, 2);
          await waitFor(
            `Array.from(document.querySelectorAll('[aria-label="Title"]')).some(node => node.getBoundingClientRect().width > 0 && node.value === ${JSON.stringify(rescanTitle)})`,
          );
          checked("rescanExternalMetadataVisible");

          const original = assertOriginal(row);
          const originalBytes = readFileSync(join(directory, original.path));
          const thumbnail = row.files.find((file) =>
            /thumbnail/.test(file.kind),
          );
          assert.ok(thumbnail);
          const thumbnailPath = join(directory, thumbnail.path);
          const thumbnailBytes = readFileSync(thumbnailPath);
          const damaged = Buffer.from("deliberately damaged owned thumbnail");
          writeFileSync(thumbnailPath, damaged);
          await openRepair("Repair Thumbnails", "thumbnails", row.id);
          await clickText(`${repair} button`, "Cancel");
          assert.deepEqual(readFileSync(thumbnailPath), damaged);
          checked("repairPreviewCancelNoWrite");
          await openRepair("Repair Thumbnails", "thumbnails", row.id);
          await applyRepair("thumbnails", true);
          let repairedRow = await query("saves.get", { id: row.id });
          const repairedThumb = repairedRow.files.find((file) =>
            /thumbnail/.test(file.kind),
          );
          assert.equal(
            (
              await sharp(
                readFileSync(join(directory, repairedThumb.path)),
              ).metadata()
            ).format,
            "webp",
          );
          await undo(async () => {
            const current = await query("saves.get", { id: row.id });
            return (
              isDeepStrictEqual(current.files, row.files) &&
              existsSync(thumbnailPath) &&
              readFileSync(thumbnailPath).equals(damaged)
            );
          });
          writeFileSync(thumbnailPath, thumbnailBytes);
          checked("thumbnailRepairAndKeyboardUndo");

          const badName = "bad:name.png";
          renameSync(join(directory, original.path), join(directory, badName));
          const physical = readJson(infoPath);
          physical.files = physical.files.map((file) =>
            file.path === original.path ? { ...file, path: badName } : file,
          );
          writeFileSync(infoPath, JSON.stringify(physical));
          await newAction("Rescan Library");
          await waitUntil(
            async () =>
              (await query("saves.get", { id: row.id })).files.some(
                (file) => file.path === badName,
              ),
            "owned nonportable filename fixture indexed",
          );
          await openRepair(
            "Repair Physical File Names",
            "physical-file-names",
            row.id,
          );
          await applyRepair("physical-file-names", true);
          repairedRow = await query("saves.get", { id: row.id });
          assert.equal(repairedRow.title, rescanTitle);
          assert.equal(
            repairedRow.files.some((file) => file.path === badName),
            false,
          );
          assertOriginal(repairedRow);
          assert.equal(existsSync(join(directory, badName)), false);
          await undo(
            async () =>
              (await query("saves.get", { id: row.id })).files.some(
                (file) => file.path === badName,
              ) && existsSync(join(directory, badName)),
          );
          assert.deepEqual(
            readFileSync(join(directory, badName)),
            originalBytes,
          );
          renameSync(join(directory, badName), join(directory, original.path));
          physical.files = row.files;
          writeFileSync(infoPath, JSON.stringify(physical));
          await newAction("Rescan Library");
          await waitUntil(
            async () =>
              (await query("saves.get", { id: row.id })).files.some(
                (file) => file.path === original.path,
              ),
            "physical fixture restored",
          );
          checked("physicalNamesRepairAndKeyboardUndo");

          rmSync(join(directory, original.path));
          await openRepair("Repair Invalid Content", "invalid-content", row.id);
          await applyRepair("invalid-content", true);
          assert.ok((await query("saves.get", { id: row.id })).deletedAt);
          await undo(
            async () => !(await query("saves.get", { id: row.id })).deletedAt,
          );
          writeFileSync(join(directory, original.path), originalBytes);
          assert.deepEqual(readFileSync(thumbnailPath), thumbnailBytes);
          checked("invalidContentRepairAndKeyboardUndo");

          const metadata = readJson(infoPath);
          metadata.id = "owned-metadata-out-of-date";
          writeFileSync(infoPath, JSON.stringify(metadata));
          await openRepair("Repair Save Metadata", "save-metadata", row.id);
          metadata.id = "owned-metadata-changed-after-preview";
          writeFileSync(infoPath, JSON.stringify(metadata));
          await clickText(`${repair} button`, "Repair");
          await waitFor(
            `document.querySelector(${JSON.stringify(repair)})?.textContent.includes('changed. Preview the repair again.')`,
          );
          assert.equal(readJson(infoPath).id, metadata.id);
          await clickText(`${repair} button`, "Cancel");
          checked("staleRepairPreviewRejected");
          await openRepair("Repair Save Metadata", "save-metadata", row.id);
          await applyRepair("save-metadata", false);
          assert.equal(readJson(infoPath).id, row.id);
          assert.equal(readJson(infoPath).title, rescanTitle);
          assert.deepEqual(
            readFileSync(join(directory, original.path)),
            originalBytes,
          );
          assert.deepEqual(readFileSync(thumbnailPath), thumbnailBytes);
          checked("saveMetadataRepairNoUndoPromised");
          await snapshot("host-maintenance-repairs-complete");
        }
      }
    } catch (error) {
      failure = error;
      record.failure = {
        message: error.message,
        stack: error.stack,
        phase: record.uiPhase,
      };
      saveRecord();
      await snapshot("host-maintenance-failed").catch(() => {});
    } finally {
      try {
        record.restoreStage = "reconnect";
        saveRecord();
        const current = await connect();
        record.restoreStage = "disable-test-watch";
        saveRecord();
        const currentWatch = await status();
        if (recoveryOnly && !currentWatch.path.startsWith(`${owned}${sep}`)) {
          assert.deepEqual(
            {
              enabled: currentWatch.enabled,
              path: currentWatch.path,
              mode: currentWatch.mode,
            },
            originalPrefs.autoImport,
            "Recovery must not replace a watched folder configured after this probe.",
          );
        }
        const resetWatch =
          activated || currentWatch.path.startsWith(`${owned}${sep}`);
        if (resetWatch) {
          await api("watched-folder", {
            name: "autoImport.set",
            params: {
              enabled: false,
              path: "",
              mode: originalPrefs.autoImport.mode,
            },
          });
          assert.equal((await status()).enabled, false);
          assert.equal((await status()).path, "");
        }
        record.restoreStage = "open-original";
        saveRecord();
        if (resolve(current.path) !== resolve(initial.path))
          await switchSetup(initial.path);
        record.restoreStage = "verify-original";
        saveRecord();
        if (originalPrefs.autoImport.path && resetWatch) {
          const paused = await location(originalPrefs.autoImport.path, "watch");
          await api("watched-folder", {
            name: "autoImport.pickFolder",
            params: { folder: paused.handle, enabled: false },
          });
        }
        const final = await query("library.info");
        assert.equal(final.path, initial.path);
        assert.equal(
          readJson(join(final.path, "metadata.json")).id,
          originalId,
        );
        for (const field of ["name", "icon", "mark", "accent"])
          assert.deepEqual(final[field], initial[field]);
        assert.deepEqual(
          (await query("settings.getPrefs")).autoImport,
          originalPrefs.autoImport,
        );
        if (pointerPath) assert.equal(readJson(pointerPath).path, initial.path);
        assert.deepEqual(
          (await query("settings.getPrefs")).ai,
          originalPrefs.ai,
        );
        record.restored = true;
        delete record.restoreError;
        record.restoreStage = "clean-fixtures";
        saveRecord();
        assert.equal(dirname(owned), parent);
        assert.match(basename(owned), /^Circe host maintenance \d+-\d+$/);
        assert.equal(initial.path.startsWith(`${owned}${sep}`), false);
        for (const path of record.createdLibraries)
          await query("library.recent.remove", { path });
        rmSync(owned, { recursive: true, force: true });
        record.cleaned = !existsSync(owned);
        record.restoreStage = "complete";
        await snapshot("host-maintenance-original-restored");
      } catch (error) {
        record.restoreError = error.message;
        failure = failure
          ? new AggregateError(
              [failure, error],
              "Host maintenance failed and recovery needs attention.",
            )
          : error;
      } finally {
        saveRecord();
        debuggerApi.removeListener("message", network);
        win.webContents.removeListener("did-start-navigation", onNavigation);
        if (debuggerApi.isAttached()) debuggerApi.detach();
      }
    }
    if (failure) throw failure;
    assert.equal(record.restored && record.cleaned, true);
    console.log(
      recoveryOnly
        ? "WEB_HOST_MAINTENANCE_RESTORED"
        : chooserOnly
          ? "WEB_HOST_CHOOSER_PASSED"
          : "WEB_HOST_MAINTENANCE_PASSED",
      JSON.stringify({
        ...record.checks,
        restored: record.restored,
        cleaned: record.cleaned,
      }),
    );
  };
