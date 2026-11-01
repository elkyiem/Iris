const assert = require("node:assert/strict");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const {
  chmodSync,
  existsSync,
  lstatSync,
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
const { app } = require("electron");
const JSZip = require("jszip");
const sharp = require("sharp");

const quote = JSON.stringify;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const entries = (path) => (existsSync(path) ? readdirSync(path).sort() : []);
const emptyBookmarksError =
  "That file has no web bookmarks. Export bookmarks as HTML from your browser and try again.";
const aiOff = {
  semanticSearch: false,
  enableCaption: false,
  enableOcr: false,
  enableTranscript: false,
  enableClip: false,
  enableAesthetic: false,
  enableSensitiveContent: false,
  enableAutoTitle: false,
  enableSuggestedTags: false,
};
const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`;

async function makeFixtures(directory, nonce) {
  const prefix = `Circe formats ${nonce}`;
  // Port 1 is forbidden by Chromium: valid bookmark syntax, no external host or account.
  const url = (name) => `http://127.0.0.1:1/${nonce}/${name}`;
  const folders = ["Bookmarks", "Nested", "Chromium"].map(
    (name) => `${prefix} ${name}`,
  );
  const bookmarks = [
    { source: "web", sourceId: url("one?a=1&b=2"), date: 1600000000000 },
    { source: "web", sourceId: url("two"), date: 1700000300000 },
    { source: "web", sourceId: url("three"), date: 1700000400000 },
  ];
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Owned bookmark fixture</TITLE><DL><p>
<DT><H3>${folders[0]}</H3><DL><p>
<DT><H3>${folders[1]}</H3><DL><p>
<DT><A HREF="${bookmarks[0].sourceId.replaceAll("&", "&amp;")}" ADD_DATE="1700000200">Owned nested link</A>
</DL><p>
<DT><A HREF="${bookmarks[0].sourceId.replaceAll("&", "&amp;")}" ADD_DATE="1600000000">Duplicate with earlier date</A>
<DT><A HREF="${bookmarks[1].sourceId}" ADD_DATE="1700000300">Owned parent link</A>
<DT><A HREF="javascript:void(0)">Skip script URL</A>
</DL><p></DL><p>`;
  const chromium = JSON.stringify({
    version: 1,
    roots: {
      bookmark_bar: {
        type: "folder",
        name: "Bookmarks bar",
        children: [
          {
            type: "folder",
            name: folders[2],
            children: [
              {
                type: "url",
                name: "Owned Chromium link",
                url: bookmarks[2].sourceId,
                date_added: String(
                  (BigInt(bookmarks[2].date) + 11644473600000n) * 1000n,
                ),
              },
            ],
          },
        ],
      },
      other: { type: "folder", name: "Other bookmarks", children: [] },
      synced: { type: "folder", name: "Mobile bookmarks", children: [] },
    },
  });
  const inputTags = ["café 水", "reference", "edited"].map(
    (name) => `${prefix} ${name}`,
  );
  // Native @pond/schema/label-name deliberately stores ASCII labels. Keep the
  // exported Unicode input and assert its existing native normalization exactly.
  const tags = [`${prefix} caf`, inputTags[1], inputTags[2]];
  const note = {
    source: "local",
    sourceId: `mymind:${nonce}-note`,
    title: `${prefix} note`,
    body: 'Quoted "text", café 水\nSecond line\n\nPersonal annotation',
    date: Date.UTC(2024, 2, 2, 12),
  };
  const image = {
    source: "local",
    sourceId: `mymind:${nonce}-image`,
    title: `${prefix} image`,
    filename: `${nonce}-image.png`,
    url: url("image-reference"),
    notes: "Image content\n\nImage annotation",
    date: Date.UTC(2024, 2, 3, 12),
  };
  const imageBytes = await sharp(randomBytes(48 * 32 * 3), {
    raw: { width: 48, height: 32, channels: 3 },
  })
    .png()
    .toBuffer();
  const orphanBytes = await sharp(randomBytes(40 * 24 * 3), {
    raw: { width: 40, height: 24, channels: 3 },
  })
    .png()
    .toBuffer();
  const orphan = {
    source: "local",
    sourceId: `mymind-file:${digest(orphanBytes)}`,
    filename: `${nonce}-orphan.png`,
    sha256: digest(orphanBytes),
  };
  image.sha256 = digest(imageBytes);
  const rows = [
    ["id", "type", "title", "url", "content", "note", "tags", "created"],
    [
      `${nonce}-note`,
      "Note",
      note.title,
      "",
      'Quoted "text", café 水\nSecond line',
      "Personal annotation",
      inputTags.slice(0, 2).join(", "),
      new Date(note.date).toISOString(),
    ],
    [
      `${nonce}-image`,
      "Image",
      image.title,
      image.url,
      "Image content",
      "Image annotation",
      inputTags.slice(0, 2).join(", "),
      new Date(image.date).toISOString(),
    ],
    [`${nonce}-missing`, "Image", `${nonce}-missing.png`, "", "", "", "", ""],
    [`${nonce}-empty`, "Placeholder", "", "", "", "", "", ""],
  ];
  const zip = new JSZip();
  zip.file(
    "cards.csv",
    rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
  );
  zip.file(image.filename, imageBytes);
  zip.file(orphan.filename, orphanBytes);
  const files = [
    { name: "bookmarks.html", bytes: Buffer.from(html) },
    { name: "Bookmarks.json", bytes: Buffer.from(chromium) },
    {
      name: "mymind.zip",
      bytes: await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
      }),
    },
    {
      name: "empty-bookmarks.html",
      bytes: Buffer.from(
        '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><A HREF="file:///owned">Skip</A></DL>',
      ),
    },
  ].map(({ name, bytes }) => {
    const path = join(directory, name);
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    return { path, name, size: bytes.length, sha256: digest(bytes) };
  });
  return {
    prefix,
    folders,
    bookmarks,
    note,
    image,
    orphan,
    tags,
    inputTags,
    files,
  };
}

/** Root supplies the existing host/browser. All target imports use a trusted menu and real file input. */
exports.verifyBrowserImportFormats = async function verifyBrowserImportFormats({
  win,
  run,
  waitFor,
  snapshot,
  query,
  origin,
  evidence,
  sandbox,
  refreshSession,
}) {
  assert.match(
    win.webContents.session.getStoragePath() ?? "",
    /iris-browser-smoke-/,
  );
  const startedAt = Date.now();
  const deadline = startedAt + 240000;
  const nonce = randomUUID();
  const originalTitle = win.getTitle();
  const qaTitle = `Circe import formats QA ${nonce}`;
  const preserveQaTitle = (event) => event.preventDefault();
  win.on("page-title-updated", preserveQaTitle);
  win.setTitle(qaTitle);
  const original = await query("library.info");
  const originalId = readJson(join(original.path, "metadata.json")).id;
  const originalPrefs = await query("settings.getPrefs");
  const originalPipelinePaused = (await query("pipeline.status")).paused;
  assert.equal(
    originalPrefs.autoImport.enabled,
    false,
    "Leave the original watched-folder policy untouched.",
  );
  const parent = dirname(resolve(original.path));
  const owned = join(parent, `Circe import formats ${nonce}`);
  const libraryPath = join(owned, "Formats.pond");
  const directory = join(evidence, `import-formats-${startedAt}`);
  mkdirSync(directory, { mode: 0o700 });
  const fixture = await makeFixtures(directory, nonce);
  const appData = join(sandbox, "app-data");
  const uploadRoot = join(appData, "web-files", "uploads");
  const downloadRoot = join(appData, "web-files", "downloads");
  const initialUploads = entries(uploadRoot);
  const initialDownloads = entries(downloadRoot);
  const initialIndexes = entries(join(appData, "indexes"));
  const protectedFiles = [
    join(appData, "library-location.json"),
    join(sandbox, "library-location.json"),
    join(appData, "recent-libraries.json"),
  ].map((path) => ({
    path,
    bytes: existsSync(path) ? readFileSync(path, "utf8") : null,
  }));
  const originalMarker = await run("localStorage.getItem('pond:importedFrom')");
  const recordPath = join(directory, "ownership-and-results.json");
  const record = {
    nonce,
    browser: { pid: process.pid, windowId: win.id, title: qaTitle },
    cancellation: {
      status:
        process.env.CIRCE_FORMAT_NATIVE_CANCEL === "1"
          ? "pending"
          : "unavailable",
      reason:
        "CUA must uniquely identify this PID and QA parent title before dismissing its actual Open sheet; empty CDP selection does not emit trusted cancel.",
    },
    original: { ...original, libraryId: originalId },
    originalPrefs,
    originalPipelinePaused,
    protectedFiles,
    originalMarker,
    owned,
    library: { path: libraryPath, id: null },
    fixtures: fixture,
    saves: [],
    folders: [],
    tags: [],
    uploads: [],
    uploadResponses: [],
    replies: [],
    choices: [],
    sessions: [],
    checks: [],
    captureErrors: [],
    cleanup: { restored: false, removedLibrary: false, purged: [], errors: [] },
  };
  const saveRecord = () => {
    writeFileSync(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 });
    chmodSync(recordPath, 0o600);
  };
  saveRecord();
  const ownedSessions = new Set();
  const sessionHostname = new URL(origin).hostname;
  const trackSession = (value) => {
    if (ownedSessions.has(value)) return;
    ownedSessions.add(value);
    record.sessions.push({ sha256: digest(value) });
    saveRecord();
  };
  const cookieChanged = (_event, cookie) => {
    if (
      cookie.name === "iris_session" &&
      cookie.domain.replace(/^\./, "") === sessionHostname &&
      cookie.path === "/"
    )
      trackSession(cookie.value);
  };
  win.webContents.session.cookies.on("changed", cookieChanged);
  const initialSessions = await win.webContents.session.cookies.get({
    url: origin,
    name: "iris_session",
  });
  assert.equal(initialSessions.length, 1);
  for (const cookie of initialSessions) trackSession(cookie.value);
  let cleaning = false;
  const waitUntil = async (read, label, timeout = 20000) => {
    const end = cleaning
      ? Date.now() + timeout
      : Math.min(deadline, Date.now() + timeout);
    let cause;
    while (Date.now() < end) {
      try {
        const value = await read();
        if (value) return value;
      } catch (error) {
        cause = error;
      }
      await pause(75);
    }
    throw new Error(`Import-format acceptance timed out: ${label}`, { cause });
  };
  const headers = async () => {
    const cookies = await win.webContents.session.cookies.get({
      url: origin,
      name: "iris_session",
    });
    assert.equal(cookies.length, 1);
    const cookie = `iris_session=${cookies[0].value}`;
    const session = await fetch(`${origin}/web/session`, {
      headers: { cookie },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(session.status, 200);
    return {
      cookie,
      origin,
      "x-iris-library": (await session.json()).libraryId,
    };
  };
  const request = async (route, body, method = "POST") => {
    const options = {
      method,
      headers: { ...(await headers()), "content-type": "application/json" },
      signal: AbortSignal.timeout(20000),
    };
    if (body !== undefined) options.body = JSON.stringify(body);
    return fetch(`${origin}/web/${route}`, options);
  };
  const api = async (...args) => {
    const response = await request(...args);
    assert.equal(response.status, 200);
    return response.json();
  };
  const location = async (path, purpose) => {
    const roots = (await api("locations", { action: "list", purpose })).entries;
    let entry = roots
      .filter(
        (candidate) =>
          path === candidate.path || path.startsWith(`${candidate.path}${sep}`),
      )
      .sort((a, b) => b.path.length - a.path.length)[0];
    assert(entry, "Owned setup must remain inside an advertised host root.");
    for (const name of relative(entry.path, path).split(sep).filter(Boolean)) {
      const listing = await api("locations", {
        action: "list",
        purpose,
        handle: entry.handle,
        filter: name,
        hidden: true,
      });
      entry = listing.entries.find((candidate) => candidate.name === name);
      assert(entry, "Resolve the exact fixture directory.");
    }
    return entry;
  };
  const debuggerApi = win.webContents.debugger;
  assert.equal(debuggerApi.isAttached(), false);
  debuggerApi.attach("1.3");
  const key = (keyCode) => {
    for (const type of ["keyDown", "keyUp"])
      win.webContents.sendInputEvent({ type, keyCode });
  };
  const click = async (selector) => {
    app.focus({ steal: true });
    win.focus();
    win.webContents.focus();
    await waitFor("document.hasFocus()");
    const prompt = `Array.from(document.querySelectorAll('[role="dialog"]')).some(node=>/^(Meet Your Fish|What's New)/.test(node.querySelector('h2,[role="heading"]')?.textContent?.trim()??'')||Array.from(node.querySelectorAll('button')).some(button=>button.textContent.trim()==='Not Now'))`;
    if (await run(prompt)) {
      key("Escape");
      await waitFor(`!(${prompt})`);
    }
    const point = await run(`new Promise((resolvePoint,reject)=>{
      let previous='',stable=0;const started=Date.now();
      const check=()=>{const node=document.querySelector(${quote(selector)});
        if(node){node.scrollIntoView({block:'nearest',inline:'nearest'});const rect=node.getBoundingClientRect();
          const point={x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};
          const next=JSON.stringify(point),hit=document.elementFromPoint(point.x,point.y);stable=previous===next?stable+1:0;previous=next;
          if(rect.width&&rect.height&&hit&&node.contains(hit)&&stable>=3){resolvePoint(point);return;}}
        if(Date.now()-started>10000){reject(new Error('The actual import control is not clickable'));return;}requestAnimationFrame(check);};check();})`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      const input = { type, ...point };
      if (type !== "mouseMoved")
        Object.assign(input, {
          button: "left",
          buttons: type === "mousePressed" ? 1 : 0,
          clickCount: 1,
        });
      await debuggerApi.sendCommand("Input.dispatchMouseEvent", input);
    }
  };
  const choose = async (action, path) => {
    if (!path) {
      await debuggerApi.sendCommand("Page.setInterceptFileChooserDialog", {
        enabled: false,
      });
      try {
        await action();
        // The reserved GUI owner dismisses this genuine OS picker with CUA Escape.
        // Empty CDP selection does not emit a cancel for a newly empty input.
        record.waitingForNativeCancel = record.currentAction;
        saveRecord();
        await waitFor("!document.querySelector('input[type=file]')");
        record.choices.push({ path: null, mode: "native-single-file" });
      } finally {
        record.waitingForNativeCancel = null;
        await debuggerApi.sendCommand("Page.setInterceptFileChooserDialog", {
          enabled: true,
        });
        saveRecord();
      }
      return;
    }
    let listener;
    let timer;
    const opened = new Promise((resolveChooser, reject) => {
      timer = setTimeout(
        () => reject(new Error("The actual browser chooser did not open.")),
        12000,
      );
      listener = (_event, method, params) => {
        if (method === "Page.fileChooserOpened") resolveChooser(params);
      };
      debuggerApi.on("message", listener);
    });
    try {
      const [, chooser] = await Promise.all([action(), opened]);
      assert.equal(chooser.mode, "selectSingle");
      const node = await debuggerApi.sendCommand("DOM.describeNode", {
        backendNodeId: chooser.backendNodeId,
      });
      assert.equal(node.node.attributes.includes("webkitdirectory"), false);
      await debuggerApi.sendCommand("DOM.setFileInputFiles", {
        backendNodeId: chooser.backendNodeId,
        files: path ? [path] : [],
      });
      // Chromium owns selection/cancellation events. A fabricated DOM cancel would conceal a hang.
      await waitFor("!document.querySelector('input[type=file]')");
      record.choices.push({
        path: path ? basename(path) : null,
        mode: chooser.mode,
      });
      saveRecord();
    } finally {
      clearTimeout(timer);
      debuggerApi.removeListener("message", listener);
    }
  };
  const load = async (url) => {
    let timer;
    try {
      await Promise.race([
        win.loadURL(url),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            win.webContents.stop();
            reject(new Error("Finite import-format navigation timed out."));
          }, 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const connect = async () => {
    await waitUntil(
      async () => {
        await load(origin);
        return true;
      },
      "reloaded host",
      60000,
    );
    await waitUntil(
      () =>
        run(
          "Boolean(document.querySelector('#host-key-file,[data-library-search]'))",
        ),
      "login or application",
      60000,
    );
    if (await run("Boolean(document.querySelector('#host-key-file'))"))
      await choose(
        () => click('button[aria-label="Choose key file"]'),
        join(sandbox, "web-access-key"),
      );
    await waitFor(
      "Boolean(window.pond)&&Boolean(document.querySelector('[data-library-search]'))",
    );
    await refreshSession({ allowLibraryChange: true });
  };
  const transition = async (name, params) => {
    const instance = async () => {
      const response = await fetch(`${origin}/web/ready`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(response.status, 200);
      return (await response.json()).instance;
    };
    const previous = await instance();
    const result = await api("library", { name, params });
    assert.equal(result.ok, true);
    if (name === "library.createAt") {
      record.library.id = readJson(join(libraryPath, "metadata.json")).id;
      assert.notEqual(record.library.id, originalId);
      saveRecord();
    }
    if (result.restarting)
      await waitUntil(
        async () => (await instance()) !== previous,
        "native replacement host",
        60000,
      );
    await connect();
  };
  const assertOwnedLibrary = async () => {
    assert.equal((await query("library.info")).path, libraryPath);
    assert.equal(
      readJson(join(libraryPath, "metadata.json")).id,
      record.library.id,
    );
    assert.notEqual(record.library.id, originalId);
  };
  const readAll = async () => {
    const rows = [];
    const cursors = new Set();
    let cursor = null;
    do {
      assert(
        !cursors.has(JSON.stringify(cursor)),
        "Native pagination must advance.",
      );
      cursors.add(JSON.stringify(cursor));
      const page = await query("saves.listPage", { limit: 500, cursor });
      rows.push(...page.rows);
      assert(
        rows.length <= 6,
        "The owned Library contains at most six fixture Saves.",
      );
      cursor = page.nextCursor;
    } while (cursor);
    return rows;
  };
  const expectedSaves = [
    ...fixture.bookmarks,
    fixture.note,
    fixture.image,
    fixture.orphan,
  ];
  const discover = async () => {
    await assertOwnedLibrary();
    const rows = await readAll();
    for (const row of rows) {
      const expected = expectedSaves.find(
        (value) =>
          value.source === row.source && value.sourceId === row.sourceId,
      );
      assert(
        expected,
        "The owned Library must contain only exact fixture source identities.",
      );
      const previous = record.saves.find(
        (value) => value.sourceId === row.sourceId,
      );
      if (previous) assert.equal(previous.id, row.id);
      else
        record.saves.push({
          id: row.id,
          source: row.source,
          sourceId: row.sourceId,
        });
    }
    record.folders = await query("folders.list");
    for (const folder of record.folders)
      assert(fixture.folders.includes(folder.name));
    record.tags = await query("tags.list");
    for (const tag of record.tags) assert(fixture.tags.includes(tag.name));
    saveRecord();
    return rows;
  };
  const exact = async (expected) => {
    const matches = (await discover()).filter(
      (row) =>
        row.source === expected.source && row.sourceId === expected.sourceId,
    );
    assert.equal(matches.length, 1);
    return query("saves.get", { id: matches[0].id });
  };
  const observed = new Map();
  const pending = new Set();
  const network = (_event, method, params) => {
    if (method === "Network.requestWillBeSent") {
      const url = new URL(params.request.url);
      if (url.origin !== new URL(origin).origin) return;
      if (url.pathname === "/web/upload" && params.request.method === "PUT") {
        const header = Object.entries(params.request.headers).find(
          ([name]) => name.toLowerCase() === "x-iris-filename",
        );
        const file = fixture.files.find(
          (value) => value.name === decodeURIComponent(header?.[1] ?? ""),
        );
        if (file) observed.set(params.requestId, { kind: "upload", file });
      } else if (url.pathname === "/web/files" && params.request.postData) {
        const input = JSON.parse(params.request.postData);
        if (
          ["saves.importBookmarks", "saves.importMymind"].includes(input.name)
        ) {
          observed.set(params.requestId, {
            kind: "import",
            name: input.name,
            paths: input.params.paths,
          });
          try {
            assert.equal(input.params.paths.length, 1);
            const token = input.params.paths[0];
            assert.match(token, /^iris-upload:[a-f0-9-]{36}$/);
            const file = fixture.files.find(
              (value) => value.name === record.currentFile,
            );
            assert(file);
            const path = join(uploadRoot, token.slice("iris-upload:".length));
            const metadata = readJson(join(path, "upload.json"));
            assert.equal(metadata.libraryId, record.library.id);
            assert.equal(metadata.filename, file.name);
            assert.equal(metadata.size, file.size);
            assert.equal(
              digest(readFileSync(join(path, metadata.filename))),
              file.sha256,
            );
            record.uploads.push({ ...file, token });
            saveRecord();
          } catch (error) {
            record.captureErrors.push(
              `Native staged-file proof: ${error.message}`,
            );
            saveRecord();
          }
        }
      }
    } else if (
      method === "Network.responseReceived" &&
      observed.has(params.requestId)
    ) {
      observed.get(params.requestId).status = params.response.status;
    } else if (
      method === "Network.loadingFailed" &&
      observed.has(params.requestId)
    ) {
      record.captureErrors.push(
        `Owned ${observed.get(params.requestId).kind} request failed: ${params.errorText}`,
      );
      observed.delete(params.requestId);
      saveRecord();
    } else if (
      method === "Network.loadingFinished" &&
      observed.has(params.requestId)
    ) {
      const value = observed.get(params.requestId);
      observed.delete(params.requestId);
      if (value.kind === "upload") {
        record.uploadResponses.push({
          name: value.file.name,
          status: value.status,
        });
        saveRecord();
        return;
      }
      const capture = debuggerApi
        .sendCommand("Network.getResponseBody", { requestId: params.requestId })
        .then(({ body, base64Encoded }) => {
          const result = JSON.parse(
            base64Encoded ? Buffer.from(body, "base64").toString() : body,
          );
          record.replies.push({
            name: value.name,
            paths: value.paths,
            status: value.status,
            result,
          });
          saveRecord();
        })
        .catch((error) => {
          record.captureErrors.push(error.message);
          saveRecord();
        })
        .finally(() => pending.delete(capture));
      pending.add(capture);
    }
  };
  debuggerApi.on("message", network);
  const openAction = async (label) => {
    if (!(await run("Boolean(document.querySelector('[aria-label=\"New\"]'))")))
      await click('[aria-label="Toggle Sidebar"]');
    await click('[aria-label="New"]');
    await click('[aria-label="Search Actions"]');
    await win.webContents.insertText(label);
    const find = `Array.from(document.querySelectorAll('[role="menuitem"]')).find(node=>node.textContent.trim()===${quote(label)}||Array.from(node.querySelectorAll('span')).some(span=>span.textContent.trim()===${quote(label)}))`;
    await waitFor(`Boolean(${find})`);
    await run(`(${find}).setAttribute('data-format-test-action','true')`);
    await click('[data-format-test-action="true"]');
  };
  const installObservation = () =>
    run(`(() => {
    const state=window.__circeFormatAcceptance={clicks:[],events:[]};
    state.click=event=>{const node=event.target.closest('[role="menuitem"]');if(node)state.clicks.push({trusted:event.isTrusted,text:node.textContent.trim()});};
    state.file=event=>{if(event.target.matches('input[type=file]'))state.events.push({type:event.type,trusted:event.isTrusted,files:Array.from(event.target.files).map(file=>({name:file.name,size:file.size}))});};
    document.addEventListener('click',state.click,true);for(const type of ['change','cancel'])document.addEventListener(type,state.file,true);
    state.dispose=()=>{document.removeEventListener('click',state.click,true);for(const type of ['change','cancel'])document.removeEventListener(type,state.file,true);};
  })()`);
  const perform = async (name, filename, expected) => {
    const label =
      name === "saves.importBookmarks" ? "Import Bookmarks" : "Import mymind";
    record.currentAction = label;
    record.currentFile = filename;
    saveRecord();
    const before = record.replies.length;
    const uploadsBefore = record.uploads.length;
    const responsesBefore = record.uploadResponses.length;
    const observation = await run(
      "({clicks:window.__circeFormatAcceptance.clicks.length,events:window.__circeFormatAcceptance.events.length})",
    );
    await choose(
      () => openAction(label),
      filename
        ? fixture.files.find((file) => file.name === filename).path
        : null,
    );
    const events = await run(
      `window.__circeFormatAcceptance.events.slice(${observation.events})`,
    );
    assert(
      events.some(
        (event) =>
          event.trusted && event.type === (filename ? "change" : "cancel"),
      ),
      "Require Chromium's own trusted chooser completion.",
    );
    const clicks = await run(
      `window.__circeFormatAcceptance.clicks.slice(${observation.clicks})`,
    );
    assert(clicks.some((event) => event.trusted && event.text.includes(label)));
    if (!filename) {
      await pause(200);
      assert.equal(record.uploads.length, uploadsBefore);
      assert.equal(record.replies.length, before);
      return;
    }
    const reply = await waitUntil(
      () => record.replies[before],
      `${label} native response`,
    );
    await Promise.all(pending);
    assert.deepEqual(record.captureErrors, []);
    assert.equal(reply.name, name);
    assert.equal(reply.status, expected.error ? 422 : 200);
    assert.deepEqual(
      reply.result,
      expected.error
        ? { error: expected.error }
        : { ok: true, imported: expected.imported, skipped: expected.skipped },
    );
    assert.equal(record.uploads.length, uploadsBefore + 1);
    assert.deepEqual(record.uploadResponses.slice(responsesBefore), [
      { name: filename, status: 200 },
    ]);
    assert.deepEqual(reply.paths, [record.uploads.at(-1).token]);
    assert.deepEqual(
      entries(downloadRoot),
      initialDownloads,
      "The native Mymind reader must retire its extraction tree.",
    );
    assert.equal((await query("pipeline.status")).paused, true);
    await discover();
  };
  const prove = async (name) => {
    record.checks.push(name);
    saveRecord();
    await snapshot(`import-formats-${nonce}-${name}`);
  };
  const edit = async (save) => {
    await query("saves.bulkEdit", {
      ids: [save.id],
      operation: { kind: "notes", notes: `${fixture.prefix} user edit` },
    });
    await query("saves.bulkEdit", {
      ids: [save.id],
      operation: { kind: "tags", mode: "replace", tags: [fixture.tags[2]] },
    });
  };
  let failure;
  try {
    await debuggerApi.sendCommand("Network.enable", {
      maxTotalBufferSize: 16 * 1024 * 1024,
      maxResourceBufferSize: 4 * 1024 * 1024,
      enableDurableMessages: true,
    });
    await debuggerApi.sendCommand("Page.enable");
    await debuggerApi.sendCommand("Page.setInterceptFileChooserDialog", {
      enabled: true,
    });
    assert.equal(existsSync(owned), false);
    await api("locations", {
      action: "mkdir",
      purpose: "parent",
      parent: (await location(parent, "parent")).handle,
      name: basename(owned),
    });
    const identity = lstatSync(owned);
    record.ownedIdentity = { device: identity.dev, inode: identity.ino };
    writeFileSync(
      join(owned, "owner.json"),
      JSON.stringify({ nonce, ...record.ownedIdentity }),
      { flag: "wx", mode: 0o600 },
    );
    saveRecord();
    await transition("library.createAt", {
      parent: (await location(owned, "parent")).handle,
      name: "Formats",
    });
    await assertOwnedLibrary();
    await query("settings.setPrefs", { ai: aiOff });
    const prefs = await query("settings.getPrefs");
    for (const [name, value] of Object.entries(aiOff))
      assert.equal(prefs.ai[name], value);
    assert.deepEqual(prefs.sync.accounts, {});
    assert.deepEqual(await readAll(), []);
    record.pipelinePauseRequested = true;
    saveRecord();
    const paused = await api("command", {
      name: "pipelinePause",
      paused: true,
    });
    assert.equal(paused.ok && paused.paused, true);
    record.pipelinePausedForFixture = true;
    saveRecord();
    await installObservation();
    if (process.env.CIRCE_FORMAT_NATIVE_CANCEL === "1") {
      await perform("saves.importBookmarks", null, {});
      await perform("saves.importMymind", null, {});
      assert.deepEqual(await readAll(), []);
      assert.deepEqual(await query("folders.list"), []);
      assert.deepEqual(await query("tags.list"), []);
      record.cancellation.status = "passed";
      await prove("trusted-picker-cancellations-create-nothing");
    }
    await perform("saves.importBookmarks", "bookmarks.html", {
      imported: 2,
      skipped: 0,
    });
    const first = await exact(fixture.bookmarks[0]);
    for (const expected of fixture.bookmarks.slice(0, 2)) {
      const save = await exact(expected);
      assert.equal(save.url, expected.sourceId);
      assert.equal(save.savedAt, expected.date);
      assert.equal(save.createdAt, expected.date);
    }
    const parentFolder = record.folders.find(
      (folder) => folder.name === fixture.folders[0],
    );
    const childFolder = record.folders.find(
      (folder) => folder.name === fixture.folders[1],
    );
    assert.equal(parentFolder.parentId, null);
    assert.equal(childFolder.parentId, parentFolder.id);
    assert.deepEqual(
      (await query("folders.memberships"))
        .filter((entry) => entry.saveId === first.id)
        .map((entry) => entry.folderId)
        .sort(),
      [parentFolder.id, childFolder.id].sort(),
    );
    await edit(first);
    await perform("saves.importBookmarks", "bookmarks.html", {
      imported: 0,
      skipped: 2,
    });
    assert.equal(
      (await exact(fixture.bookmarks[0])).notes,
      `${fixture.prefix} user edit`,
    );
    assert.deepEqual((await exact(fixture.bookmarks[0])).tags, [
      fixture.tags[2],
    ]);
    assert.equal(record.folders.length, 2);
    await perform("saves.importBookmarks", "Bookmarks.json", {
      imported: 1,
      skipped: 0,
    });
    const chromiumSave = await exact(fixture.bookmarks[2]);
    assert.equal(chromiumSave.savedAt, fixture.bookmarks[2].date);
    assert.equal(chromiumSave.createdAt, fixture.bookmarks[2].date);
    const chromiumFolder = record.folders.find(
      (folder) => folder.name === fixture.folders[2],
    );
    assert.equal(chromiumFolder.parentId, null);
    assert.deepEqual(
      (await query("folders.memberships")).filter(
        (entry) => entry.saveId === chromiumSave.id,
      ),
      [{ saveId: chromiumSave.id, folderId: chromiumFolder.id }],
    );
    await perform("saves.importBookmarks", "Bookmarks.json", {
      imported: 0,
      skipped: 1,
    });
    await query("saves.skipIngest", {
      ids: record.saves
        .filter((save) => save.source === "web")
        .map((save) => save.id),
    });
    await prove("native-html-json-bookmarks-dates-folders-dedup-and-edits");
    await perform("saves.importMymind", "mymind.zip", {
      imported: 3,
      skipped: 2,
    });
    const note = await exact(fixture.note);
    assert.equal(note.title, fixture.note.title);
    assert.equal(note.description, fixture.note.body);
    assert.equal(note.notes, null);
    assert.equal(note.savedAt, fixture.note.date);
    assert.equal(note.createdAt, fixture.note.date);
    assert.deepEqual(note.tags, fixture.tags.slice(0, 2));
    const image = await exact(fixture.image);
    assert.equal(image.title, fixture.image.title);
    assert.equal(image.url, fixture.image.url);
    assert.equal(image.notes, fixture.image.notes);
    assert.equal(image.savedAt, fixture.image.date);
    assert.equal(image.createdAt, fixture.image.date);
    assert.deepEqual(image.tags, fixture.tags.slice(0, 2));
    for (const expected of [fixture.image, fixture.orphan]) {
      const save = await exact(expected);
      const file = save.files.find((entry) => entry.path === expected.filename);
      assert(file);
      assert.equal(file.sha256, expected.sha256);
      const response = await request(
        `media/${encodeURIComponent(save.id)}/${file.path.split("/").map(encodeURIComponent).join("/")}`,
        undefined,
        "GET",
      );
      assert.equal(response.status, 200);
      assert.equal(
        digest(Buffer.from(await response.arrayBuffer())),
        expected.sha256,
      );
    }
    await edit(image);
    await perform("saves.importMymind", "mymind.zip", {
      imported: 0,
      skipped: 5,
    });
    assert.equal(
      (await exact(fixture.image)).notes,
      `${fixture.prefix} user edit`,
    );
    assert.deepEqual((await exact(fixture.image)).tags, [fixture.tags[2]]);
    assert.equal((await exact(fixture.note)).description, fixture.note.body);
    assert.equal((await discover()).length, 6);
    await prove(
      "native-mymind-zip-notes-tags-source-identity-bytes-and-repeat",
    );
    const ids = record.saves.map((save) => save.id).sort();
    const folderState = await query("folders.list");
    await perform("saves.importBookmarks", "empty-bookmarks.html", {
      error: emptyBookmarksError,
    });
    assert.deepEqual(record.saves.map((save) => save.id).sort(), ids);
    assert.deepEqual(await query("folders.list"), folderState);
    await prove("empty-bookmark-error-matches-native-and-creates-nothing");
    await load(origin);
    await waitFor(
      "Boolean(window.pond)&&Boolean(document.querySelector('[data-library-search]'))",
    );
    assert.equal((await discover()).length, 6);
    assert.equal((await exact(fixture.note)).description, fixture.note.body);
    await prove("native-imported-records-survive-browser-reload");
  } catch (error) {
    failure = error;
    record.failure = { message: error.message, stack: error.stack };
    await snapshot(`import-formats-${nonce}-failure`).catch(() => {});
  } finally {
    cleaning = true;
    const cleanup = async (label, operation) => {
      try {
        await operation();
      } catch (error) {
        record.cleanup.errors.push(`${label}: ${error.message}`);
      }
      saveRecord();
    };
    await cleanup("Pending import responses", async () => {
      await waitUntil(
        () => !observed.size && !pending.size,
        "actual imports settle before cleanup",
      );
    });
    await cleanup("Owned Library cleanup", async () => {
      await connect();
      if ((await query("library.info")).path !== libraryPath) return;
      if (!record.library.id)
        record.library.id = readJson(join(libraryPath, "metadata.json")).id;
      await cleanup("Discover exact fixture identities", discover);
      const webIds = record.saves
        .filter((save) => save.source === "web")
        .map((save) => save.id);
      if (webIds.length)
        await cleanup("Drain owned link ingest", () =>
          query("saves.skipIngest", { ids: webIds }),
        );
      for (const row of record.saves)
        await cleanup(`Purge ${row.id}`, async () => {
          const current = await query("saves.get", { id: row.id });
          if (!current) return;
          assert.equal(current.source, row.source);
          assert.equal(current.sourceId, row.sourceId);
          const result = await query("saves.bulkEdit", {
            ids: [row.id],
            operation: { kind: "purge" },
            actorReason: "test:import-formats-cleanup",
          });
          assert.equal(result.changed, 1);
          record.cleanup.purged.push(row.id);
        });
      for (const folder of record.folders.sort(
        (a, b) => Number(Boolean(b.parentId)) - Number(Boolean(a.parentId)),
      ))
        await cleanup(`Folder ${folder.id}`, async () => {
          assert(fixture.folders.includes(folder.name));
          assert(
            !(await query("folders.memberships")).some(
              (entry) => entry.folderId === folder.id,
            ),
          );
          assert.equal(
            (
              await query("folders.delete", {
                id: folder.id,
                trashContainedSaves: false,
              })
            ).ok,
            true,
          );
        });
      for (const tag of await query("tags.list"))
        await cleanup(`Tag ${tag.name}`, async () => {
          assert(fixture.tags.includes(tag.name));
          assert.equal(
            (await query("tags.delete", { name: tag.name })).ok,
            true,
          );
        });
      // A completed upload can outlive a lost browser response. Its exact native
      // Library scope, fixture name/size/hash and new UUID prove cleanup ownership.
      for (const ticket of entries(uploadRoot).filter(
        (name) => !initialUploads.includes(name),
      )) {
        await cleanup(`Discover upload ${ticket}`, async () => {
          assert.match(ticket, /^[a-f0-9-]{36}$/);
          const metadata = readJson(join(uploadRoot, ticket, "upload.json"));
          assert.equal(metadata.libraryId, record.library.id);
          const file = fixture.files.find(
            (value) =>
              value.name === metadata.filename && value.size === metadata.size,
          );
          assert(file);
          assert.equal(
            digest(readFileSync(join(uploadRoot, ticket, metadata.filename))),
            file.sha256,
          );
          const token = `iris-upload:${ticket}`;
          if (!record.uploads.some((upload) => upload.token === token))
            record.uploads.push({ ...file, token, recoveredForCleanup: true });
        });
      }
      for (const upload of record.uploads) {
        await cleanup(`Upload ${upload.token}`, async () => {
          const ticket = upload.token.slice("iris-upload:".length);
          assert.match(ticket, /^[a-f0-9-]{36}$/);
          if (!existsSync(join(uploadRoot, ticket))) return;
          assert(!initialUploads.includes(ticket));
          const metadata = readJson(join(uploadRoot, ticket, "upload.json"));
          assert.equal(metadata.libraryId, record.library.id);
          assert.equal(metadata.filename, upload.name);
          assert.equal(metadata.size, upload.size);
          assert.equal(
            digest(readFileSync(join(uploadRoot, ticket, metadata.filename))),
            upload.sha256,
          );
          await api(
            `upload/${encodeURIComponent(upload.token)}`,
            undefined,
            "DELETE",
          );
          upload.removed = true;
        });
      }
      assert.deepEqual(await readAll(), []);
      assert.deepEqual(await query("folders.list"), []);
      assert.deepEqual(await query("tags.list"), []);
      record.cleanup.fixtureLibraryEmpty = true;
      assert.deepEqual(entries(uploadRoot), initialUploads);
      assert.deepEqual(entries(downloadRoot), initialDownloads);
    });
    await cleanup("Restore original Library", async () => {
      if ((await query("library.info")).path !== original.path)
        await transition("library.switchTo", {
          source: (await location(original.path, "open")).handle,
        });
      assert.deepEqual(await query("library.info"), original);
      assert.equal(
        readJson(join(original.path, "metadata.json")).id,
        originalId,
      );
      assert.deepEqual(await query("settings.getPrefs"), originalPrefs);
      if (record.pipelinePauseRequested) {
        const restored = await api("command", {
          name: "pipelinePause",
          paused: originalPipelinePaused,
        });
        assert.equal(restored.ok, true);
        assert.equal(restored.paused, originalPipelinePaused);
      }
      assert.equal(
        (await query("pipeline.status")).paused,
        originalPipelinePaused,
      );
      await query("library.recent.remove", { path: libraryPath });
      // Native transitions intentionally update pointer/history timestamps. Restore their
      // exact snapshots only after the native owner has reopened the original Library.
      for (const file of protectedFiles) {
        const current = existsSync(file.path)
          ? readFileSync(file.path, "utf8")
          : null;
        if (basename(file.path) === "recent-libraries.json") {
          const allowed = new Set(
            (file.bytes ? JSON.parse(file.bytes) : []).map(
              (entry) => entry.path,
            ),
          );
          allowed.add(original.path);
          allowed.add(libraryPath);
          for (const entry of current ? JSON.parse(current) : [])
            assert(allowed.has(entry.path));
        } else if (current)
          assert.equal(JSON.parse(current).path, original.path);
        if (file.bytes === null) {
          if (current !== null) rmSync(file.path);
        } else if (current !== file.bytes) {
          const temporary = `${file.path}.${nonce}.restore`;
          writeFileSync(temporary, file.bytes, { flag: "wx", mode: 0o600 });
          renameSync(temporary, file.path);
        }
        assert.equal(
          existsSync(file.path) ? readFileSync(file.path, "utf8") : null,
          file.bytes,
        );
      }
      await run(
        `(()=>{const value=${quote(originalMarker)};if(value===null)localStorage.removeItem('pond:importedFrom');else localStorage.setItem('pond:importedFrom',value);})()`,
      );
      assert.equal(
        await run("localStorage.getItem('pond:importedFrom')"),
        originalMarker,
      );
      record.cleanup.restored = true;
    });
    await cleanup("Remove exact owned Library", async () => {
      assert(record.cleanup.restored);
      if (!existsSync(owned)) return;
      const identity = lstatSync(owned);
      assert(identity.isDirectory() && !identity.isSymbolicLink());
      assert.equal(identity.dev, record.ownedIdentity.device);
      assert.equal(identity.ino, record.ownedIdentity.inode);
      assert.deepEqual(readJson(join(owned, "owner.json")), {
        nonce,
        ...record.ownedIdentity,
      });
      if (!record.library.id && !existsSync(libraryPath)) {
        assert.deepEqual(entries(owned), ["owner.json"]);
        rmSync(owned, { recursive: true });
        record.cleanup.removedLibrary = true;
        return;
      }
      assert.deepEqual(entries(owned), ["Formats.pond", "owner.json"]);
      assert(
        record.cleanup.fixtureLibraryEmpty,
        "Leave an unexpected or incompletely cleaned fixture Library for inspection.",
      );
      assert.equal(
        readJson(join(libraryPath, "metadata.json")).id,
        record.library.id,
      );
      assert.notEqual(record.library.id, originalId);
      assert.equal((await query("library.info")).path, original.path);
      rmSync(owned, { recursive: true });
      record.cleanup.removedLibrary = true;
      for (const suffix of [".db", ".db-wal", ".db-shm"]) {
        const name = `${record.library.id}${suffix}`;
        assert(!initialIndexes.includes(name));
        const path = join(appData, "indexes", name);
        if (existsSync(path)) {
          const file = lstatSync(path);
          assert(file.isFile() && !file.isSymbolicLink());
          rmSync(path);
        }
      }
    });
    await cleanup("Input fixtures unchanged", async () => {
      for (const file of fixture.files) {
        assert.equal(readFileSync(file.path).length, file.size);
        assert.equal(digest(readFileSync(file.path)), file.sha256);
      }
      assert.deepEqual(record.captureErrors, []);
      assert.deepEqual(await query("library.info"), original);
      assert.deepEqual(await query("settings.getPrefs"), originalPrefs);
    });
    await cleanup("Revoke exact owned browser sessions", async () => {
      for (const cookie of await win.webContents.session.cookies.get({
        url: origin,
        name: "iris_session",
      }))
        trackSession(cookie.value);
      for (const value of ownedSessions) {
        const proof = record.sessions.find(
          (session) => session.sha256 === digest(value),
        );
        assert(proof);
        const logout = await fetch(`${origin}/web/session`, {
          method: "DELETE",
          headers: { origin, cookie: `iris_session=${value}` },
          signal: AbortSignal.timeout(10000),
        });
        proof.logoutStatus = logout.status;
        await logout.arrayBuffer();
        assert.equal(logout.status, 200);
        const verified = await fetch(`${origin}/web/session`, {
          headers: { cookie: `iris_session=${value}` },
          signal: AbortSignal.timeout(10000),
        });
        proof.verificationStatus = verified.status;
        await verified.arrayBuffer();
        assert.equal(verified.status, 401);
        saveRecord();
      }
      await win.webContents.session.cookies.remove(origin, "iris_session");
      record.cleanup.sessionsRevoked = true;
    });
    win.webContents.session.cookies.removeListener("changed", cookieChanged);
    await run("window.__circeFormatAcceptance?.dispose()").catch(() => {});
    debuggerApi.removeListener("message", network);
    if (debuggerApi.isAttached()) debuggerApi.detach();
    win.removeListener("page-title-updated", preserveQaTitle);
    win.setTitle(originalTitle);
    record.elapsedMs = Date.now() - startedAt;
    saveRecord();
  }
  assert.deepEqual(record.cleanup.errors, [], record.cleanup.errors.join("\n"));
  assert(record.cleanup.restored && record.cleanup.removedLibrary);
  if (failure) throw failure;
  console.log(
    "WEB_IMPORT_FORMATS_PASSED",
    JSON.stringify({ record: recordPath, checks: record.checks }),
  );
};
