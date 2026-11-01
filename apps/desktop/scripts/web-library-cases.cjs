const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { homedir } = require("node:os");
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

const manifestName = "pond-backup-manifest.json";
const picker = '[data-library-admin-picker="true"]';
const hostRows = `${picker} [aria-label="Host folders"] [role="option"]`;
const connected =
  'Boolean(document.querySelector(\'#fixture-kind, [data-slot="window"], [data-library-search], [aria-label="Library Name"]\'))';
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const metadata = (path) =>
  JSON.parse(readFileSync(join(path, "metadata.json"), "utf8"));

exports.verifyBrowserLibraries = async function verifyBrowserLibraries({
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
  restoreOnly = false,
}) {
  const recordPath = join(evidence, "library-admin-restore.json");
  const previousRecord = restoreOnly
    ? JSON.parse(readFileSync(recordPath, "utf8"))
    : null;
  const initial = previousRecord?.original ?? (await query("library.info"));
  const originalId = metadata(initial.path).id;
  assert.match(basename(initial.path), /\.pond$/i);
  const home = resolve(homedir());
  const parent = dirname(resolve(initial.path));
  assert.ok(
    parent === home || parent.startsWith(`${home}${sep}`),
    "The UI probe may only create fixtures below the Mac home location.",
  );
  const fixtureRoot =
    previousRecord?.fixtureRoot ??
    join(parent, `Circe library admin ${process.pid}-${Date.now()}`);
  if (!restoreOnly) assert.equal(existsSync(fixtureRoot), false);
  const sourcePath = join(fixtureRoot, "My Pond.pond");
  const backupPath = join(fixtureRoot, "Snapshot.pond");
  const restoredPath = join(fixtureRoot, "Restored.pond");
  const movedPath = join(fixtureRoot, "Moved.pond");
  const targetParent = join(fixtureRoot, "Merge target");
  const targetPath = join(targetParent, "My Pond.pond");
  const pointerPath = [
    join(sandbox, "app-data", "library-location.json"),
    join(sandbox, "library-location.json"),
  ].find(existsSync);
  const record = previousRecord ?? {
    original: { ...initial, libraryId: originalId },
    pointer: pointerPath ? JSON.parse(readFileSync(pointerPath, "utf8")) : null,
    fixtureRoot,
    sourcePath,
    backupPath,
    restoredPath,
    movedPath,
    targetPath,
    restored: false,
    cleaned: false,
    checks: {},
  };
  const saveRecord = () => {
    writeFileSync(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 });
    chmodSync(recordPath, 0o600);
  };
  saveRecord();
  assert.equal(statSync(recordPath).mode & 0o777, 0o600);

  const waitUntil = async (read, label, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    let lastError;
    while (Date.now() < deadline) {
      try {
        const value = await read();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await pause(100);
    }
    throw new Error(`Library administration timed out: ${label}`, {
      cause: lastError,
    });
  };
  const key = (keyCode) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
  };
  const mark = async (selector, predicate, label) => {
    await waitFor(
      `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(node => node.getBoundingClientRect().width > 0 && (${predicate}))`,
    );
    await run(`(() => {
      document.querySelectorAll('[data-library-admin-control]').forEach(node => node.removeAttribute('data-library-admin-control'));
      const node = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node => node.getBoundingClientRect().width > 0 && (${predicate}));
      if (!node) throw new Error(${JSON.stringify(`Missing Library control: ${label}`)});
      node.setAttribute('data-library-admin-control', 'target');
    })()`);
    return '[data-library-admin-control="target"]';
  };
  const clickText = async (selector, text) =>
    click(
      await mark(
        selector,
        `node.textContent.trim() === ${JSON.stringify(text)}`,
        text,
      ),
    );
  const replaceInput = async (selector, value) => {
    await click(selector);
    await waitFor(
      `document.activeElement === document.querySelector(${JSON.stringify(selector)})`,
    );
    win.webContents.selectAll();
    await win.webContents.insertText(value);
    await waitFor(
      `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`,
    );
  };
  const instance = async () => {
    const response = await fetch(`${origin}/web/ready`, {
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.ok(value.instance);
    return value.instance;
  };
  const debuggerApi = win.webContents.debugger;
  debuggerApi.attach("1.3");
  await debuggerApi.sendCommand("Page.enable");
  await debuggerApi.sendCommand("Network.enable");
  await debuggerApi.sendCommand("Page.setInterceptFileChooserDialog", {
    enabled: true,
  });
  const requests = new Map();
  const replies = [];
  let lastSession = (
    await win.webContents.session.cookies.get({
      url: origin,
      name: "iris_session",
    })
  )[0]?.value;
  let sessionChanges = 0;
  const network = (_event, method, params) => {
    if (
      method === "Network.requestWillBeSent" &&
      params.request.url === `${origin}/web/library`
    ) {
      requests.set(params.requestId, JSON.parse(params.request.postData).name);
    }
    if (method !== "Network.loadingFinished" || !requests.has(params.requestId))
      return;
    const name = requests.get(params.requestId);
    requests.delete(params.requestId);
    void debuggerApi
      .sendCommand("Network.getResponseBody", { requestId: params.requestId })
      .then(({ body, base64Encoded }) => {
        const reply = {
          name,
          result: JSON.parse(
            base64Encoded ? Buffer.from(body, "base64").toString() : body,
          ),
        };
        replies.push(reply);
        record.responses ??= [];
        record.responses.push(reply);
        saveRecord();
      })
      .catch((error) => replies.push({ name, error: error.message }));
  };
  debuggerApi.on("message", network);
  const replyAfter = (index, name) =>
    waitUntil(
      () => replies.slice(index).find((reply) => reply.name === name),
      `${name} response`,
      20000,
    );
  const pickFile = async (activate, path) => {
    let listener;
    let timer;
    const opened = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("The Library probe file chooser did not open.")),
        15000,
      );
      listener = (_event, method, params) => {
        if (method === "Page.fileChooserOpened") resolve(params);
      };
      debuggerApi.on("message", listener);
    });
    try {
      const [, chosen] = await Promise.all([activate(), opened]);
      await debuggerApi.sendCommand("DOM.setFileInputFiles", {
        backendNodeId: chosen.backendNodeId,
        files: [path],
      });
    } finally {
      clearTimeout(timer);
      debuggerApi.removeListener("message", listener);
    }
  };
  const connect = async ({
    previous,
    expectedPath,
    expectedId,
    navigate = false,
  } = {}) => {
    await waitUntil(
      async () => !previous || (await instance()) !== previous,
      "replacement host readiness",
    );
    if (navigate) await win.loadURL(origin);
    const login = "Boolean(document.querySelector('#host-key-file'))";
    await waitUntil(
      () => run(previous ? login : `(${login}) || (${connected})`),
      "Library login or connected client",
    );
    if (await run(login)) {
      await pickFile(
        () => click('button[aria-label="Choose key file"]'),
        join(sandbox, "web-access-key"),
      );
      await waitUntil(() => run(connected), "access-key file login");
    }
    const session = await refreshSession({ allowLibraryChange: true });
    const nextSession = (
      await win.webContents.session.cookies.get({
        url: origin,
        name: "iris_session",
      })
    )[0]?.value;
    assert.ok(nextSession, "The rendered login must establish a host cookie.");
    if (previous) {
      assert.ok(
        nextSession !== lastSession,
        "Restarted hosts must require a fresh browser session.",
      );
      sessionChanges++;
    }
    lastSession = nextSession;
    const info = await query("library.info");
    if (expectedPath) assert.equal(resolve(info.path), resolve(expectedPath));
    if (expectedId) assert.equal(session.libraryId, expectedId);
    assert.equal(session.libraryId, metadata(info.path).id);
    return { ...info, libraryId: session.libraryId };
  };
  const libraryMenu = async () => {
    await win.loadURL(`${origin}/?q=`);
    await waitFor(
      `${connected} || Array.from(document.querySelectorAll('button')).some(node => node.textContent.trim() === 'Exit settings')`,
    );
    if (
      await run(
        "Array.from(document.querySelectorAll('button')).some(node => node.textContent.trim() === 'Exit settings')",
      )
    )
      await clickText("button", "Exit settings");
    await waitFor("document.querySelector('[data-library-search]')");
    if (
      !(await run(
        "document.querySelector('[data-slot=\"window\"]')?.hasAttribute('data-left-open')",
      ))
    )
      await click('[aria-label="Toggle Sidebar"]');
    await click('[aria-label="Library Menu"]');
    await clickText('[role="menuitem"]', "Switch Library");
  };
  const menuAction = async (name) => {
    await libraryMenu();
    await clickText('[role="menuitem"]', name);
  };
  const tagPicker = async () => {
    await waitFor(
      'document.querySelector(\'[role="dialog"] [aria-label="Host folders"]\')',
    );
    await run(`(() => {
      document.querySelectorAll('[data-library-admin-picker]').forEach(node => node.removeAttribute('data-library-admin-picker'));
      document.querySelector('[aria-label="Host folders"]').closest('[role="dialog"]').setAttribute('data-library-admin-picker', 'true');
    })()`);
    await waitFor(
      `document.querySelector(${JSON.stringify(`${picker} [aria-label="Host folders"]`)})?.getAttribute('aria-busy') === 'false'`,
    );
  };
  const atFolder = (path) =>
    waitFor(
      `Array.from(document.querySelectorAll(${JSON.stringify(`${picker} [title]`)})).some(node => node.title === ${JSON.stringify(path)}) && document.querySelector(${JSON.stringify(`${picker} [aria-label="Host folders"]`)})?.getAttribute('aria-busy') === 'false'`,
    );
  const row = (name) =>
    mark(
      hostRows,
      `node.querySelector('span')?.textContent === ${JSON.stringify(name)}`,
      name,
    );
  const browseRow = async (name, path) => {
    await replaceInput(`${picker} [aria-label="Filter host folders"]`, name);
    await click(await row(name), 2);
    await atFolder(path);
  };
  const navigateDirectory = async (path) => {
    assert.ok(path === home || resolve(path).startsWith(`${home}${sep}`));
    await tagPicker();
    if (
      !(await run(
        `Array.from(document.querySelectorAll(${JSON.stringify(`${picker} [title]`)})).some(node => node.title === ${JSON.stringify(path)})`,
      ))
    ) {
      const locations = await mark(
        `${picker} button`,
        "node.textContent.trim() === 'Locations'",
        "Locations",
      );
      if (
        !(await run(
          `document.querySelector(${JSON.stringify(locations)}).disabled`,
        ))
      )
        await click(locations);
      await waitFor(
        `document.querySelector(${JSON.stringify(`${picker} [aria-label="Filter host folders"]`)})?.disabled && document.querySelector(${JSON.stringify(`${picker} [aria-label="Host folders"]`)})?.getAttribute('aria-busy') === 'false'`,
      );
      const hasMacHome = await run(
        `Array.from(document.querySelectorAll(${JSON.stringify(hostRows)})).some(node => node.querySelector('span')?.textContent === 'Mac home')`,
      );
      assert.ok(
        hasMacHome || parent === home,
        "The host must expose the Mac home picker location.",
      );
      await click(await row(hasMacHome ? "Mac home" : "Library folders"), 2);
      await atFolder(home);
      let current = home;
      for (const name of relative(home, resolve(path))
        .split(sep)
        .filter(Boolean)) {
        if (
          name.startsWith(".") &&
          !(await run(
            `document.querySelector(${JSON.stringify(`${picker} input[type="checkbox"]`)}).checked`,
          ))
        )
          await click(`${picker} input[type="checkbox"]`);
        current = join(current, name);
        await browseRow(name, current);
      }
    }
  };
  const newFolder = async (name, path) => {
    await clickText(`${picker} button`, "New folder");
    await replaceInput(`${picker} [aria-label="New host folder name"]`, name);
    await clickText(`${picker} form button`, "Create folder");
    await atFolder(path);
    assert.ok(statSync(path).isDirectory());
  };
  const selectLibrary = async (path) => {
    await navigateDirectory(dirname(path));
    await replaceInput(
      `${picker} [aria-label="Filter host folders"]`,
      basename(path),
    );
    await click(await row(basename(path)));
    await clickText(`${picker} button`, "Open");
    await waitUntil(
      () =>
        run(
          "!document.querySelector('[aria-label=\"Host folders\"]') || Boolean(document.querySelector('[aria-label=\"Library destination name\"]'))",
        ),
      "source picker completion",
      20000,
    );
  };
  const cancelPicker = async () => {
    await tagPicker();
    await click(
      await mark(
        `${picker} button`,
        "node.textContent.trim() === 'Cancel' && !node.closest('form')",
        "picker Cancel",
      ),
    );
    await waitFor("!document.querySelector('[aria-label=\"Host folders\"]')");
  };
  const destination = async (path) => {
    await waitFor(
      'document.querySelector(\'[role="dialog"] [aria-label="Library destination name"]\')',
    );
    await navigateDirectory(dirname(path));
    await replaceInput(
      `${picker} [aria-label="Library destination name"]`,
      basename(path),
    );
    await clickText(`${picker} button`, "Save here");
  };
  const verifyMedia = (path, save) => {
    const original = save.files.find(
      (file) => file.sha256 && !/thumbnail/.test(file.kind ?? ""),
    );
    assert.ok(original, "The fixture must contain a hashed original.");
    const bytes = readFileSync(
      join(path, "items", `${save.id}.info`, original.path),
    );
    assert.equal(bytes.byteLength, original.size);
    assert.equal(digest(bytes), original.sha256);
    return original.sha256;
  };
  const verifyManifest = (path) => {
    const manifest = JSON.parse(readFileSync(join(path, manifestName), "utf8"));
    assert.equal(manifest.version, 1);
    assert.ok(manifest.files.some((file) => file.path === "metadata.json"));
    assert.ok(
      manifest.files.some((file) =>
        /items\/.+\.info\/info\.json$/.test(file.path),
      ),
    );
    for (const file of manifest.files) {
      const resolved = resolve(path, file.path);
      assert.ok(resolved.startsWith(`${resolve(path)}${sep}`));
      const bytes = readFileSync(resolved);
      assert.equal(bytes.byteLength, file.size, file.path);
      assert.equal(digest(bytes), file.sha256, file.path);
    }
    return manifest;
  };
  const createLibrary = async (folder, createParent = false) => {
    const previous = await instance();
    await menuAction("Create Library");
    await navigateDirectory(createParent ? dirname(folder) : folder);
    if (createParent) await newFolder(basename(folder), folder);
    await clickText(`${picker} button`, "Select folder");
    return connect({ previous, expectedPath: join(folder, "My Pond.pond") });
  };
  const importImage = async (number) => {
    const file = join(evidence, `library-admin-image-${number}.png`);
    writeFileSync(
      file,
      await sharp({
        create: {
          width: 48,
          height: 32,
          channels: 3,
          background: { r: 30 + number * 35, g: 90, b: 120 },
        },
      })
        .png()
        .toBuffer(),
    );
    const previous = new Set(
      (await query("saves.listPage", { limit: 10 })).rows.map(
        (save) => save.id,
      ),
    );
    await win.loadURL(`${origin}/?q=`);
    await waitFor("document.querySelector('[data-library-search]')");
    if (
      !(await run(
        "document.querySelector('[data-slot=\"window\"]')?.hasAttribute('data-left-open')",
      ))
    )
      await click('[aria-label="Toggle Sidebar"]');
    await click('[aria-label="New"]');
    await waitFor("document.querySelector('[aria-label=\"Search Actions\"]')");
    await replaceInput('[aria-label="Search Actions"]', "Import Files");
    const importControl = await mark(
      '[role="menuitem"]',
      "node.querySelector('[data-menu-breadcrumb-current]')?.textContent === 'Import Files'",
      "Import Files",
    );
    await pickFile(() => click(importControl), file);
    return waitUntil(
      async () => {
        const rows = (await query("saves.listPage", { limit: 10 })).rows.filter(
          (save) => !previous.has(save.id),
        );
        assert.ok(
          rows.length <= 1,
          "One selected image must not create duplicate Saves.",
        );
        if (
          rows.length !== 1 ||
          rows[0].status !== "complete" ||
          !rows[0].files.length
        )
          return false;
        assert.equal(rows[0].mediaType, "image");
        verifyMedia((await query("library.info")).path, rows[0]);
        return rows[0];
      },
      "image upload through the real browser Import Files action",
      30000,
    );
  };
  const recentLibrary = async (path) => {
    const entries = await run("window.pond.query('library.recent', {})");
    const entry = entries.find((item) => resolve(item.path) === resolve(path));
    assert.ok(entry?.available, "The chosen recent Library must be available.");
    const ordinal = entries
      .filter((item) => item.name === entry.name)
      .findIndex((item) => resolve(item.path) === resolve(path));
    await libraryMenu();
    await waitFor(
      `Array.from(document.querySelectorAll('[role="menuitem"]')).filter(node => node.textContent.trim() === ${JSON.stringify(entry.name)} && node.getBoundingClientRect().width > 0).length > ${ordinal}`,
    );
    await run(`(() => {
      const nodes = Array.from(document.querySelectorAll('[role="menuitem"]')).filter(node => node.textContent.trim() === ${JSON.stringify(entry.name)} && node.getBoundingClientRect().width > 0);
      if (!nodes[${ordinal}]) throw new Error('The requested recent Library is not rendered.');
      nodes[${ordinal}].setAttribute('data-library-admin-control', 'recent');
    })()`);
    await click('[data-library-admin-control="recent"]');
  };
  const settings = async (section, control) => {
    await win.loadURL(`${origin}/settings/${section}`);
    await waitFor(`document.querySelector(${JSON.stringify(control)})`);
  };
  let failure;
  try {
    if (!restoreOnly) {
      const originalInstance = await instance();
      await menuAction("Create Library");
      await cancelPicker();
      assert.equal(await instance(), originalInstance);
      assert.equal((await query("library.info")).path, initial.path);
      assert.equal(existsSync(fixtureRoot), false);
      record.checks.cancelCreate = true;

      // The fixture parent itself is created through the rendered host picker.
      await menuAction("Create Library");
      await navigateDirectory(parent);
      await newFolder(basename(fixtureRoot), fixtureRoot);
      await clickText(`${picker} button`, "Back");
      await atFolder(parent);
      await browseRow(basename(fixtureRoot), fixtureRoot);
      const beforeCreate = await instance();
      await clickText(`${picker} button`, "Select folder");
      const source = await connect({
        previous: beforeCreate,
        expectedPath: sourcePath,
      });
      assert.notEqual(source.libraryId, originalId);
      record.fixtureLibraryId = source.libraryId;
      record.checks.createAndLogin = true;
      saveRecord();
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
      const first = await importImage(1);
      await snapshot("library-admin-created-image");

      const beforeBackup = await instance();
      await settings("backups", "#setting-backups-backup button");
      await click("#setting-backups-backup button");
      await cancelPicker();
      assert.equal(existsSync(backupPath), false);
      assert.equal(await instance(), beforeBackup);
      record.checks.cancelBackup = true;
      await click("#setting-backups-backup button");
      await destination(backupPath);
      await waitUntil(
        () => existsSync(join(backupPath, manifestName)),
        "backup manifest",
      );
      await waitFor(
        "document.querySelector('#setting-backups-backup [role=\"status\"]')?.textContent.includes('Backup saved')",
      );
      assert.equal(
        await instance(),
        beforeBackup,
        "Backup must keep the current host process.",
      );
      assert.equal((await query("library.info")).path, sourcePath);
      const manifest = verifyManifest(backupPath);
      writeFileSync(
        join(evidence, "library-admin-backup-manifest.json"),
        JSON.stringify(manifest, null, 2),
      );
      const backupHash = digest(readFileSync(join(backupPath, manifestName)));
      verifyMedia(backupPath, first);
      record.checks.backupManifest = true;
      await snapshot("library-admin-backup");

      // Content added after the snapshot must survive in its source and be absent from the restored copy.
      const marker = await importImage(2);
      const sourceMedia = [first, marker].map((save) =>
        verifyMedia(sourcePath, save),
      );
      await settings("backups", "#setting-backups-restore button");
      await click("#setting-backups-restore button");
      await selectLibrary(backupPath);
      await cancelPicker();
      assert.equal(existsSync(restoredPath), false);
      assert.equal((await query("library.info")).path, sourcePath);
      assert.equal(await instance(), beforeBackup);
      record.checks.cancelRestoreDestination = true;
      await click("#setting-backups-restore button");
      await selectLibrary(backupPath);
      const beforeRestore = await instance();
      await destination(restoredPath);
      const restoredInfo = await connect({
        previous: beforeRestore,
        expectedPath: restoredPath,
      });
      assert.notEqual(restoredInfo.libraryId, source.libraryId);
      assert.notEqual(restoredInfo.libraryId, originalId);
      assert.equal(metadata(sourcePath).id, source.libraryId);
      assert.equal(metadata(backupPath).id, source.libraryId);
      record.restoredLibraryId = restoredInfo.libraryId;
      assert.equal(
        existsSync(join(restoredPath, manifestName)),
        false,
        "Restoring removes the snapshot marker.",
      );
      const restored = await waitUntil(
        async () => {
          const rows = (await query("saves.listPage", { limit: 10 })).rows;
          return rows.some((save) => save.id === first.id) ? rows : false;
        },
        "the backed-up Save indexed in the fresh restored Library",
        30000,
      );
      assert.equal(restored.length, 1);
      assert.equal(restored[0].id, first.id);
      verifyMedia(restoredPath, restored[0]);
      assert.equal(
        existsSync(join(restoredPath, "items", `${marker.id}.info`)),
        false,
      );
      assert.deepEqual(
        [first, marker].map((save) => verifyMedia(sourcePath, save)),
        sourceMedia,
      );
      assert.equal(
        digest(readFileSync(join(backupPath, manifestName))),
        backupHash,
      );
      verifyManifest(backupPath);
      record.checks.restoreAndSourceUnchanged = true;
      await snapshot("library-admin-restored");

      await settings("storage", "#setting-storage-move button");
      await click("#setting-storage-move button");
      await clickText('[role="alertdialog"] button', "Move");
      await cancelPicker();
      key("Escape");
      assert.equal((await query("library.info")).path, restoredPath);
      assert.equal(existsSync(movedPath), false);
      record.checks.cancelMove = true;
      await settings("storage", "#setting-storage-move button");
      await click("#setting-storage-move button");
      await clickText('[role="alertdialog"] button', "Move");
      const beforeMove = await instance();
      const moveReplyIndex = replies.length;
      await destination(movedPath);
      await connect({
        previous: beforeMove,
        expectedPath: movedPath,
        expectedId: restoredInfo.libraryId,
      });
      verifyMedia(movedPath, first);
      assert.equal(metadata(movedPath).id, restoredInfo.libraryId);
      if (existsSync(restoredPath)) {
        const reply = await replyAfter(moveReplyIndex, "library.move");
        assert.equal(reply.result?.sourceRemoved, false);
        assert.equal(reply.result.cleanupPath, restoredPath);
        record.moveCleanup = reply.result.cleanupPath;
      }
      record.checks.moveAndMedia = true;

      // Recent switching and explicit Open use the real shared workspace menu.
      const beforeRecent = await instance();
      await recentLibrary(sourcePath);
      await connect({
        previous: beforeRecent,
        expectedPath: sourcePath,
        expectedId: source.libraryId,
      });
      assert.equal(
        (await query("saves.listPage", { limit: 10 })).rows.length,
        2,
      );
      const beforeNoop = await instance();
      await recentLibrary(sourcePath);
      key("Escape");
      key("Escape");
      await pause(350);
      assert.equal(
        await instance(),
        beforeNoop,
        "Selecting the active recent Library must not restart the host.",
      );
      assert.equal((await query("library.info")).path, sourcePath);
      record.checks.recentAndActiveNoop = true;
      const beforeOpen = await instance();
      await menuAction("Open Library");
      await selectLibrary(movedPath);
      await connect({
        previous: beforeOpen,
        expectedPath: movedPath,
        expectedId: restoredInfo.libraryId,
      });
      record.checks.open = true;

      const target = await createLibrary(targetParent, true);
      assert.notEqual(target.libraryId, source.libraryId);
      assert.notEqual(target.libraryId, restoredInfo.libraryId);
      assert.notEqual(target.libraryId, originalId);
      assert.equal(
        (await query("saves.listPage", { limit: 10 })).rows.length,
        0,
      );
      const beforeMerge = await instance();
      await menuAction("Merge Library");
      await cancelPicker();
      assert.equal(
        (await query("saves.listPage", { limit: 10 })).rows.length,
        0,
      );
      assert.equal(await instance(), beforeMerge);
      record.checks.cancelMerge = true;
      for (const expected of [
        { imported: 2, skipped: 0 },
        { imported: 0, skipped: 2 },
      ]) {
        const replyIndex = replies.length;
        await menuAction("Merge Library");
        await selectLibrary(sourcePath);
        const reply = await replyAfter(replyIndex, "library.mergeFrom");
        assert.equal(reply.error, undefined);
        assert.equal(reply.result.ok, true);
        assert.equal(reply.result.imported, expected.imported);
        assert.equal(reply.result.skipped, expected.skipped);
        assert.equal(reply.result.restarting, false);
        await waitUntil(
          async () =>
            (await query("saves.listPage", { limit: 10 })).rows.length === 2,
          "two merged Saves",
        );
        assert.equal(
          await instance(),
          beforeMerge,
          "Merging must preserve the current host process.",
        );
        assert.equal((await query("library.info")).path, targetPath);
      }
      const merged = (await query("saves.listPage", { limit: 10 })).rows;
      assert.deepEqual(
        merged.map((save) => verifyMedia(targetPath, save)).sort(),
        sourceMedia.slice().sort(),
      );
      assert.deepEqual(
        [first, marker].map((save) => verifyMedia(sourcePath, save)),
        sourceMedia,
      );
      record.checks.mergeAndDeduplicate = true;
      await snapshot("library-admin-merged");
      saveRecord();
    }
  } catch (error) {
    failure = error;
    record.failure = { message: error.message, stack: error.stack };
    saveRecord();
    await snapshot("library-admin-failed").catch(() => {});
  } finally {
    try {
      const current = await connect({ navigate: true });
      if (resolve(current.path) !== resolve(initial.path)) {
        const previous = await instance();
        await menuAction("Open Library");
        await selectLibrary(initial.path);
        await connect({
          previous,
          expectedPath: initial.path,
          expectedId: originalId,
        });
      }
      const final = await query("library.info");
      assert.equal(resolve(final.path), resolve(initial.path));
      assert.equal(metadata(final.path).id, originalId);
      for (const field of ["name", "icon", "mark", "accent"])
        assert.deepEqual(
          final[field],
          initial[field],
          `Original Library ${field} must be preserved.`,
        );
      if (pointerPath)
        assert.equal(
          resolve(JSON.parse(readFileSync(pointerPath, "utf8")).path),
          resolve(initial.path),
        );
      record.restored = true;
      delete record.restoreError;
      record.sessionChanges = sessionChanges;
      saveRecord();
      assert.ok(fixtureRoot.startsWith(`${parent}${sep}Circe library admin `));
      assert.equal(
        resolve(initial.path).startsWith(`${fixtureRoot}${sep}`),
        false,
      );
      rmSync(fixtureRoot, { recursive: true, force: true });
      record.cleaned = !existsSync(fixtureRoot);
      await snapshot("library-admin-original-restored");
    } catch (error) {
      record.restoreError = error.message;
      failure = failure
        ? new AggregateError(
            [failure, error],
            "Library acceptance failed and recovery needs attention.",
          )
        : error;
    } finally {
      saveRecord();
      debuggerApi.removeListener("message", network);
      if (debuggerApi.isAttached()) debuggerApi.detach();
    }
  }
  if (failure) throw failure;
  assert.equal(record.restored && record.cleaned, true);
  console.log(
    restoreOnly ? "WEB_LIBRARY_ADMIN_RECOVERED" : "WEB_LIBRARY_ADMIN_PASSED",
    JSON.stringify({
      ...record.checks,
      restored: record.restored,
      cleaned: record.cleaned,
    }),
  );
};
