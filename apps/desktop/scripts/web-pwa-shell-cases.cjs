const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require("node:fs");
const { join } = require("node:path");
const { setTimeout: pause } = require("node:timers/promises");
const { app } = require("electron");
const sharp = require("sharp");

const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Production browser QA only: no host restart, device simulator, or personal OS state. */
exports.verifyBrowserPwaShell = async function verifyBrowserPwaShell({
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
  assert.match(
    win.webContents.session.getStoragePath() ?? "",
    /iris-browser-smoke-/,
    "PWA tests require the disposable smoke browser profile.",
  );
  assert.equal(win.webContents.getZoomFactor(), 1);
  const recoveryOnly = process.argv.includes("--pwa-shell-restore");
  const rtlProbeOnly = process.argv.includes("--pwa-shell-rtl-probe");
  const connectionOnly = process.argv.includes("--pwa-shell-connection-only");
  const recordPath = join(evidence, "pwa-shell-restore.json");
  const previous = recoveryOnly ? json(recordPath) : null;
  const initial = previous?.initial ?? (await query("library.info"));
  const libraryId =
    previous?.libraryId ?? json(join(initial.path, "metadata.json")).id;
  const originalPrefs =
    previous?.originalPrefs ?? (await query("settings.getPrefs"));
  const storage = () =>
    run(
      "Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]))",
    );
  const originalStorage = previous?.originalStorage ?? (await storage());
  const originalSize = previous?.originalSize ?? win.getContentSize();
  const originalDir =
    previous?.originalDir ?? (await run("document.documentElement.dir"));
  const pointers =
    previous?.pointers ??
    [
      join(sandbox, "app-data/library-location.json"),
      join(sandbox, "library-location.json"),
    ]
      .filter(existsSync)
      .map((path) => ({ path, content: readFileSync(path, "utf8") }));
  const record = previous ?? {
    initial,
    libraryId,
    originalPrefs,
    originalStorage,
    originalSize,
    originalDir,
    pointers,
    runId: `pwa-${process.pid}-${Date.now()}`,
    checks: [],
    layouts: [],
    criticalTargetFailures: [],
    sessionDeletes: 0,
    navigations: [],
    restored: false,
    cleaned: false,
    limitations: [
      "Chromium browser emulation; physical iOS/iPad, Home Screen installation, and standalone launch are unverified.",
      "An installable manifest and active service worker do not prove an OS installation.",
      "An earlier run measured 28px zoom controls; this suite now checks resting Zoom Ratio/Out/In against the 44px critical-target requirement.",
    ],
  };
  const directory = join(evidence, record.runId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const saveRecord = () => {
    writeFileSync(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 });
    chmodSync(recordPath, 0o600);
    writeFileSync(
      join(directory, "results.json"),
      JSON.stringify(record, null, 2),
      { mode: 0o600 },
    );
    chmodSync(join(directory, "results.json"), 0o600);
  };
  saveRecord();
  const deadline = Date.now() + 225000;
  let restoring = false;
  const until = async (read, label, timeout = 20000) => {
    const end = Math.min(restoring ? Infinity : deadline, Date.now() + timeout);
    let cause;
    while (Date.now() < end) {
      try {
        const result = await read();
        if (result) return result;
      } catch (error) {
        cause = error;
      }
      await pause(80);
    }
    throw new Error(`PWA shell timed out: ${label}`, { cause });
  };
  const prove = async (name) => {
    record.checks.push(name);
    saveRecord();
    const label = `${record.runId}-${name}`;
    await snapshot(label);
    for (const extension of ["png", "txt"])
      chmodSync(join(evidence, `${label}.${extension}`), 0o600);
  };
  const cookies = async () => {
    const values = await win.webContents.session.cookies.get({
      url: origin,
      name: "iris_session",
    });
    assert.equal(
      values.length,
      1,
      "The actual browser session must be authenticated.",
    );
    return {
      cookie: `iris_session=${values[0].value}`,
      origin,
      "x-iris-library": libraryId,
    };
  };
  const request = async (path, options = {}) => {
    const response = await fetch(`${origin}${path}`, {
      ...options,
      headers: { ...(await cookies()), ...options.headers },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200, `${path} must succeed.`);
    return response;
  };
  const session = async () => (await request("/web/session")).json();
  const debug = win.webContents.debugger;
  let workerSessionId;
  const workerRequests = new Map();
  assert.equal(
    debug.isAttached(),
    false,
    "The previous GUI probe must release CDP.",
  );
  debug.attach("1.3");
  const onMessage = (_event, method, params, sessionId) => {
    if (method === "Network.requestWillBeSent") {
      const url = new URL(params.request.url);
      if (sessionId === workerSessionId && url.origin === origin)
        workerRequests.set(params.requestId, url.pathname);
      if (
        url.origin === origin &&
        url.pathname === "/web/session" &&
        params.request.method === "DELETE"
      )
        record.sessionDeletes++;
    }
    if (
      method === "Network.loadingFailed" &&
      sessionId === workerSessionId &&
      workerRequests.has(params.requestId)
    ) {
      record.workerNetworkFailures ??= [];
      record.workerNetworkFailures.push({
        path: workerRequests.get(params.requestId),
        error: params.errorText,
        offline: record.networkOffline === true,
      });
    }
    if (method === "Network.responseReceived" && params.type === "Document") {
      const url = new URL(params.response.url);
      if (url.origin === origin)
        record.navigations.push({
          pathname: url.pathname,
          status: params.response.status,
          fromServiceWorker: params.response.fromServiceWorker === true,
        });
    }
  };
  debug.on("message", onMessage);
  await debug.sendCommand("Page.enable");
  await debug.sendCommand("Network.enable");
  await debug.sendCommand("Page.setInterceptFileChooserDialog", {
    enabled: true,
  });
  const press = async (keyCode) => {
    for (const type of ["keyDown", "keyUp"])
      win.webContents.sendInputEvent({ type, keyCode });
    await pause(30);
  };
  const navigationBy = async (action, label) => {
    let timer;
    let finish;
    let fail;
    const loaded = new Promise((resolve, reject) => {
      finish = () => resolve();
      fail = (_event, code, description, _url, main) => {
        if (main)
          reject(
            new Error(`${label} navigation failed: ${code} ${description}`),
          );
      };
      win.webContents.on("did-finish-load", finish);
      win.webContents.on("did-fail-load", fail);
      timer = setTimeout(
        () => reject(new Error(`${label} did not finish a new Document.`)),
        20000,
      );
    });
    void loaded.catch(() => {});
    try {
      await action();
      await loaded;
      record.documentTransitions ??= [];
      record.documentTransitions.push({
        label,
        path: new URL(win.webContents.getURL()).pathname,
      });
      saveRecord();
    } finally {
      clearTimeout(timer);
      win.webContents.removeListener("did-finish-load", finish);
      win.webContents.removeListener("did-fail-load", fail);
    }
  };
  const mark = async (selector, predicate) => {
    const find = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node=>node.getBoundingClientRect().width>0&&(${predicate}))`;
    await waitFor(`Boolean(${find})`);
    await run(
      `(()=>{document.querySelectorAll('[data-pwa-control]').forEach(node=>node.removeAttribute('data-pwa-control'));(${find}).setAttribute('data-pwa-control','target')})()`,
    );
    return '[data-pwa-control="target"]';
  };
  const bounds = async (selector) =>
    run(`(()=>{
      const node=document.querySelector(${JSON.stringify(selector)});if(!node)return null;
      const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),motion=[];
      for(let parent=node;parent;parent=parent.parentElement){for(const animation of parent.getAnimations()){if(animation.playState==='running'&&Number.isFinite(animation.effect?.getComputedTiming().endTime))motion.push({tag:parent.tagName,property:animation.transitionProperty??null});}}
      const dialog=hit?.closest('[role=dialog],[role=alertdialog]');
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,hit:Boolean(hit&&node.contains(hit)),motion,pointerHit:{tag:hit?.tagName,role:hit?.getAttribute('role'),slot:hit?.getAttribute('data-slot'),label:hit?.getAttribute('aria-label'),dialog:dialog?.querySelector('h1,h2,[role=heading]')?.textContent?.trim()},viewport:{width:innerWidth,height:innerHeight}};
    })()`);
  const fit = (box) =>
    box.left >= -1 &&
    box.top >= -1 &&
    box.right <= box.viewport.width + 1 &&
    box.bottom <= box.viewport.height + 1;
  const startupPrompt =
    "Array.from(document.querySelectorAll('[role=dialog]')).some(dialog=>/^(Meet Your Fish|What's New)/.test(dialog.querySelector('h2,[role=heading]')?.textContent?.trim()??'')||Array.from(dialog.querySelectorAll('button')).some(button=>button.textContent.trim()==='Not Now'))";
  const dismissStartup = async () => {
    if (!(await run(startupPrompt))) return false;
    await press("Escape");
    await waitFor(`!(${startupPrompt})`);
    record.startupDismissals = (record.startupDismissals ?? 0) + 1;
    saveRecord();
    return true;
  };
  const control = async (selector, name, critical = false) => {
    let previousBox;
    let stable = 0;
    let lastBox;
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      if (await dismissStartup()) {
        previousBox = null;
        stable = 0;
        continue;
      }
      const box = await bounds(selector);
      lastBox = box;
      const unchanged =
        box &&
        previousBox &&
        ["left", "top", "width", "height"].every(
          (key) => Math.abs(box[key] - previousBox[key]) < 0.01,
        );
      stable = box && box.motion.length === 0 && unchanged ? stable + 1 : 0;
      previousBox = box;
      if (stable >= 2 && box.width > 0 && box.height > 0) {
        if (await dismissStartup()) {
          previousBox = null;
          stable = 0;
          continue;
        }
        record.lastPointer = { selector, name, ...box };
        assert.ok(fit(box), `${name} must fit: ${JSON.stringify(box)}`);
        assert.equal(
          box.hit,
          true,
          `${name} must receive actual pointer input: ${JSON.stringify(box.pointerHit)}`,
        );
        if (critical && (box.width < 44 || box.height < 44)) {
          // Resting geometry is strict; intentional press feedback is allowed to finish first.
          record.criticalTargetFailures.push({ name, ...box });
          saveRecord();
        }
        return box;
      }
      await pause(40);
    }
    record.lastPointer = { selector, name, ...lastBox };
    saveRecord();
    throw new Error(
      `${name} did not reach stable resting geometry: ${JSON.stringify(lastBox)}`,
    );
  };
  const tap = async (selector, name, critical = false) => {
    app.focus({ steal: true });
    win.show();
    win.focus();
    win.webContents.focus();
    await until(() => run("document.hasFocus()"), "browser DOM focus", 3000);
    const box = await control(selector, name, critical);
    const point = {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      radiusX: 1,
      radiusY: 1,
      force: 1,
      id: 1,
    };
    await debug.sendCommand("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    await debug.sendCommand("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    return box;
  };
  const settlePendingIntro = async () => {
    await pause(60);
    if (await run("localStorage.getItem('pond:fishIntro')==='due'")) {
      let observed = false;
      await until(
        async () => {
          if (
            await run(
              "Array.from(document.querySelectorAll('[role=dialog] h2,[role=dialog] [role=heading]')).some(node=>node.textContent.trim()==='Meet Your Fish')",
            )
          )
            observed = true;
          await dismissStartup();
          return (
            observed &&
            (await run("localStorage.getItem('pond:fishIntro')==='shown'"))
          );
        },
        "actual due Fish introduction shown and dismissed",
        12000,
      );
      record.delayedIntroSettledThroughUi = true;
      saveRecord();
    } else await dismissStartup();
  };
  const viewport = async (width, height, direction, zoom) => {
    win.setContentSize(width, height);
    await debug.sendCommand("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await waitFor(
      `innerWidth===${width}&&innerHeight===${height}&&matchMedia('(pointer: coarse)').matches`,
    );
    await run(
      `document.documentElement.dir=${JSON.stringify(direction)};(()=>{const key=${JSON.stringify(`iris:device-prefs:${libraryId}`)},value=JSON.parse(localStorage.getItem(key)||'{}');localStorage.setItem(key,JSON.stringify({...value,window:{...value.window,interfaceZoom:${zoom}},viewer:{...value.viewer,doubleClickAction:'open',spaceAction:'preview',spaceBehavior:'toggle'}}))})()`,
    );
    await win.loadURL(origin);
    await waitFor(
      `document.querySelector('[data-slot=window]')&&Math.abs(Number(getComputedStyle(document.body).zoom)-${zoom / 100})<0.001`,
    );
    await run(`document.documentElement.dir=${JSON.stringify(direction)}`);
    await settlePendingIntro();
  };
  const sidebar = async (open, physical = false) => {
    await waitFor(
      "document.querySelector('[data-slot=window]')&&document.querySelector('[aria-label=\"Toggle Sidebar\"]')",
    );
    const current = await run(
      "document.querySelector('[data-slot=window]').hasAttribute('data-left-open')",
    );
    if (current !== open) {
      if (physical)
        await tap('[aria-label="Toggle Sidebar"]', "Toggle Sidebar", true);
      else await click('[aria-label="Toggle Sidebar"]');
    }
    await waitFor(
      `document.querySelector('[data-slot=window]').hasAttribute('data-left-open')===${open}`,
    );
  };
  const libraryScreen = async () => {
    await waitFor("document.querySelector('[data-slot=window]')");
    if (
      await run(
        "document.querySelector('[data-slot=window]').hasAttribute('data-right-open')",
      )
    ) {
      await click('[aria-label="Toggle Details"]');
      await waitFor(
        "!document.querySelector('[data-slot=window]').hasAttribute('data-right-open')",
      );
    }
    await sidebar(true);
    if (await run("location.pathname.startsWith('/settings')"))
      await click(
        await mark("button", "node.textContent.trim()==='Exit settings'"),
      );
    await click(
      await mark(
        '[role=navigation][aria-label="Library"] button',
        "Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()==='All')",
      ),
    );
    await waitFor(
      "location.pathname==='/'&&document.querySelector('[data-library-search]')",
    );
    await sidebar(false);
  };
  const preferencesScreen = async () => {
    await libraryScreen();
    await sidebar(true);
    await click('[aria-label="Library Menu"]');
    await click(
      await mark(
        "[role=menuitem]",
        "Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()==='Settings')",
      ),
    );
    await click(
      await mark(
        '[role=navigation][aria-label="Settings"] button',
        "Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()==='Preferences')",
      ),
    );
    await waitFor("location.pathname==='/settings/general'");
    await sidebar(false);
  };
  const restoreStorage = async () => {
    await run(
      `(()=>{localStorage.clear();for(const [key,value] of Object.entries(${JSON.stringify(originalStorage)}))localStorage.setItem(key,value);document.documentElement.dir=${JSON.stringify(originalDir)}})()`,
    );
  };
  const keyFileLogin = async () => {
    await waitFor("document.querySelector('#host-key-file')");
    assert.ok(
      existsSync(join(sandbox, "web-access-key")),
      "The private access key file must already exist.",
    );
    let timer;
    let listener;
    const chooser = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("Actual access-key file chooser did not open.")),
        5000,
      );
      listener = (_event, method, params) => {
        if (method === "Page.fileChooserOpened") resolve(params);
      };
      debug.on("message", listener);
    });
    void chooser.catch(() => {});
    // Only the file path is passed to CDP; no key bytes enter tool arguments, logs, or the clipboard.
    try {
      await click('button[aria-label="Choose key file"]');
      const opened = await chooser;
      await debug.sendCommand("DOM.setFileInputFiles", {
        backendNodeId: opened.backendNodeId,
        files: [join(sandbox, "web-access-key")],
      });
    } finally {
      clearTimeout(timer);
      debug.removeListener("message", listener);
    }
    await waitFor(
      "document.querySelector('[data-slot=window]')&&!document.querySelector('#host-key-file')",
    );
    await refreshSession();
    assert.equal((await session()).libraryId, libraryId);
  };
  const stableSave = (save) =>
    Object.fromEntries(
      [
        "id",
        "source",
        "sourceId",
        "title",
        "description",
        "author",
        "url",
        "notes",
        "tags",
        "rating",
        "files",
        "rotate",
        "flipX",
        "flipY",
        "crop",
        "deletedAt",
      ].map((key) => [key, save[key]]),
    );
  const sampleImage = async () => {
    const activeScopes = Object.entries(originalPrefs.search.scopes)
      .filter(([, enabled]) => enabled)
      .map(([key]) =>
        key === "folderDescription" ? "folder-description" : key,
      );
    assert.ok(
      activeScopes.length > 0,
      "The production sample must use the actual enabled browser search scopes.",
    );
    const keywordScopes = activeScopes.length === 10 ? undefined : activeScopes;
    const page = await query("saves.listPage", { limit: 500 });
    let inspected = 0;
    for (const save of page.rows) {
      if (
        save.status !== "complete" ||
        save.deletedAt ||
        save.mediaType !== "image" ||
        !save.title ||
        save.title.length < 12 ||
        save.title.length > 180 ||
        save.rotate ||
        save.flipX ||
        save.flipY ||
        save.crop ||
        !/^[\p{L}\p{N} .!?,'’()%-]+$/u.test(save.title) ||
        save.files.filter((file) => file.kind === "image").length !== 1
      )
        continue;
      const file = save.files.find(
        (item) =>
          item.kind === "image" &&
          item.size > 0 &&
          item.size <= 5 * 1024 * 1024 &&
          item.width >= 160 &&
          item.height >= 120 &&
          item.width <= 4096 &&
          item.height <= 4096 &&
          item.width / item.height >= 0.75 &&
          item.width / item.height <= 1.75 &&
          /^image\/(png|jpeg|webp)$/.test(item.mimeType ?? ""),
      );
      if (!file) continue;
      if (++inspected > 20) break;
      const matches = await query("saves.queryPage", {
        keywords: save.title,
        keywordScopes,
        limit: 2,
      });
      if (matches.total !== 1 || matches.ids[0] !== save.id) continue;
      const current = await query("saves.get", { id: save.id });
      const mediaPath = `/web/media/${encodeURIComponent(save.id)}/${file.path.split("/").map(encodeURIComponent).join("/")}`;
      const bytes = Buffer.from(await (await request(mediaPath)).arrayBuffer());
      assert.equal(bytes.length, file.size);
      assert.equal(digest(bytes), file.sha256);
      const metadata = await sharp(bytes).metadata();
      if (metadata.orientation && metadata.orientation !== 1) continue;
      return {
        id: save.id,
        title: save.title,
        file,
        mediaPath,
        sha256: digest(bytes),
        width: metadata.width,
        height: metadata.height,
        before: stableSave(current),
      };
    }
    throw new Error(
      "No uniquely searchable completed image with bounded original bytes was found. No Library fixture was created or preference changed.",
    );
  };
  const networkOnline = async (online) => {
    if (online) win.webContents.session.disableNetworkEmulation();
    else win.webContents.session.enableNetworkEmulation({ offline: true });
    await debug.sendCommand("Network.emulateNetworkConditions", {
      offline: !online,
      latency: 0,
      downloadThroughput: online ? -1 : 0,
      uploadThroughput: online ? -1 : 0,
    });
    if (workerSessionId)
      await debug.sendCommand(
        "Network.emulateNetworkConditions",
        {
          offline: !online,
          latency: 0,
          downloadThroughput: online ? -1 : 0,
          uploadThroughput: online ? -1 : 0,
        },
        workerSessionId,
      );
    record.networkOffline = !online;
  };
  let failure;
  try {
    const currentSession = await session();
    assert.equal(currentSession.libraryId, libraryId);
    assert.equal(
      currentSession.fixtures,
      false,
      "Use production fixtures=false; the fixture bar changes the shell geometry.",
    );
    record.productionMode = true;
    if (rtlProbeOnly) {
      await viewport(390, 850, "rtl", 100);
      await sidebar(true);
      await pause(400);
      record.rtlSidebar = await run(`(()=>{
        const describe=node=>{if(!node)return null;const r=node.getBoundingClientRect(),style=getComputedStyle(node),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{tag:node.tagName,role:node.getAttribute('role'),slot:node.getAttribute('data-slot'),open:node.hasAttribute('data-open'),left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,position:style.position,cssLeft:style.left,cssRight:style.right,transform:style.transform,gridArea:style.gridArea,gridColumns:style.gridTemplateColumns,overflow:style.overflow,pointerEvents:style.pointerEvents,direction:style.direction,hit:Boolean(hit&&node.contains(hit)),hitTag:hit?.tagName,hitSlot:hit?.getAttribute('data-slot')};};
        const left=document.querySelector('[data-slot=left]'),all=Array.from(document.querySelectorAll('[role=navigation][aria-label="Library"] button')).find(node=>Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()==='All'));
        return{viewport:{width:innerWidth,height:innerHeight},root:describe(document.querySelector('[data-slot=window]')),left:describe(left),child:describe(left?.firstElementChild),all:describe(all)};
      })()`);
      record.diagnosticOnly = true;
      saveRecord();
      const label = `${record.runId}-rtl-sidebar-bounds`;
      await snapshot(label);
      for (const extension of ["png", "txt"])
        chmodSync(join(evidence, `${label}.${extension}`), 0o600);
      const all = await mark(
        '[role=navigation][aria-label="Library"] button',
        "Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()==='All')",
      );
      await control(all, "RTL Library All destination", true);
    } else if (!recoveryOnly) {
      await viewport(1280, 900, "ltr", 100);
      await libraryScreen();
      await waitFor(
        "!document.querySelector('[aria-label=\"Host connection\"]')",
      );
      assert.equal(
        await run(
          "Boolean(document.querySelector('[aria-label=\"Offline fixture\"],#fixture-kind'))",
        ),
        false,
      );
      const manifest = await debug.sendCommand("Page.getAppManifest");
      record.manifest = {
        url: manifest.url,
        errors: manifest.errors,
        data: JSON.parse(manifest.data),
      };
      assert.equal(new URL(manifest.url).pathname, "/manifest.webmanifest");
      assert.deepEqual(
        manifest.errors.filter((error) => error.critical),
        [],
      );
      const data = record.manifest.data;
      assert.equal(data.name, "Circé");
      assert.equal(data.short_name, "Circé");
      assert.equal(data.id, "/");
      assert.equal(data.scope, "/");
      assert.equal(data.start_url, "/");
      assert.equal(data.display, "standalone");
      for (const size of [192, 512])
        assert.ok(
          data.icons.some(
            (icon) =>
              icon.src === `/app-icon-${size}.png` &&
              icon.sizes === `${size}x${size}` &&
              icon.type === "image/png" &&
              icon.purpose === "any",
          ),
        );
      record.icons = await run(`(async()=>{
        const apple=document.querySelector('link[rel="apple-touch-icon"]');
        const icons=[];for(const size of [180,192,512]){
          const src='/app-icon-'+size+'.png',response=await fetch(src,{cache:'no-store'});
          if(!response.ok)throw new Error('App icon request failed: '+size);
          const bitmap=await createImageBitmap(await response.blob()),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
          const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
          let painted=0;const colors=new Set();for(let i=0;i<pixels.length;i+=4){if(pixels[i+3])painted++;colors.add([pixels[i],pixels[i+1],pixels[i+2],pixels[i+3]].join(','))}
          icons.push({size,width:bitmap.width,height:bitmap.height,painted,colors:colors.size});bitmap.close();
        }return{apple:apple?new URL(apple.href).pathname:null,viewport:document.querySelector('meta[name=viewport]')?.content,icons};
      })()`);
      assert.equal(record.icons.apple, "/app-icon-180.png");
      assert.match(record.icons.viewport, /viewport-fit=cover/);
      for (const icon of record.icons.icons) {
        assert.equal(icon.width, icon.size);
        assert.equal(icon.height, icon.size);
        assert.ok(
          icon.painted > (icon.size * icon.size) / 2 && icon.colors > 16,
          "Decoded app icons must contain useful pixels.",
        );
      }
      await prove("production-manifest-decoded-icons");
      await waitFor(
        "navigator.serviceWorker.controller?.scriptURL.endsWith('/app-sw.js')",
      );
      record.worker = await run(
        "(async()=>{const ready=await navigator.serviceWorker.ready;return{scope:ready.scope,scriptURL:ready.active?.scriptURL,state:ready.active?.state,controller:navigator.serviceWorker.controller?.scriptURL}})()",
      );
      assert.equal(record.worker.scope, `${origin}/`);
      assert.equal(record.worker.state, "activated");
      assert.equal(record.worker.scriptURL, `${origin}/app-sw.js`);
      const inspectCaches = () =>
        run(
          "(async()=>{const result=[];for(const name of await caches.keys()){const cache=await caches.open(name);result.push({name,paths:(await cache.keys()).map(request=>new URL(request.url).pathname).sort()})}return result})()",
        );
      record.caches = await inspectCaches();
      assert.equal(
        record.caches.length,
        1,
        "The disposable production profile must have only the offline explanation cache.",
      );
      assert.match(record.caches[0].name, /^circe-offline-/);
      const workerSource = await run(
        "fetch('/app-sw.js',{cache:'no-store'}).then(response=>response.text())",
      );
      const assetList = workerSource.match(/const ASSETS=(\[[^;]+\]);/);
      assert.ok(
        assetList,
        "The worker must declare its static offline assets.",
      );
      const offlineAssets = JSON.parse(assetList[1]);
      assert.deepEqual(record.caches[0].paths, offlineAssets);
      assert.ok(offlineAssets.includes("/offline.html"));
      assert.ok(offlineAssets.includes("/app-icon-192.png"));
      assert.ok(offlineAssets.some((path) => path.endsWith(".js")));
      assert.ok(offlineAssets.some((path) => path.endsWith(".css")));
      for (const path of offlineAssets)
        assert.match(
          path,
          /^\/(offline\.html|app-icon-192\.png|assets\/[\w-]+\.(js|css))$/,
        );
      await prove("activated-worker-cache-excludes-library-data");

      if (!connectionOnly) {
        record.sample = await sampleImage();
        saveRecord();

        for (const layout of [
          { width: 320, zoom: 100, direction: "ltr" },
          { width: 390, zoom: 100, direction: "ltr" },
          { width: 768, zoom: 100, direction: "ltr" },
          { width: 390, zoom: 100, direction: "rtl" },
          { width: 390, zoom: 200, direction: "ltr" },
        ]) {
          await viewport(layout.width, 850, layout.direction, layout.zoom);
          if (layout.width <= 700) {
            assert.equal(
              await run(
                "document.querySelector('[data-slot=window]').hasAttribute('data-left-open')||document.querySelector('[data-slot=window]').hasAttribute('data-right-open')",
              ),
              false,
              "Phone startup must leave both overlay drawers closed.",
            );
          }
          if (layout.width === 320 || layout.zoom === 200) {
            await tap('[aria-label="Toggle Details"]', "Toggle Details", true);
            await waitFor(
              "document.querySelector('[data-slot=window]').hasAttribute('data-right-open')&&!document.querySelector('[data-slot=window]').hasAttribute('data-left-open')",
            );
            const drawers = {
              ...layout,
              details: await control(
                "[data-slot=right][data-open]",
                "Phone Details drawer",
              ),
              detailsChild: await control(
                "[data-slot=right][data-open]>div",
                "Phone Details drawer content",
              ),
            };
            record.phoneDrawers ??= [];
            record.phoneDrawers.push(drawers);
            await tap('[aria-label="Toggle Sidebar"]', "Toggle Sidebar", true);
            await waitFor(
              "document.querySelector('[data-slot=window]').hasAttribute('data-left-open')&&!document.querySelector('[data-slot=window]').hasAttribute('data-right-open')",
            );
            const all = await mark(
              '[role=navigation][aria-label="Library"] button',
              "Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()==='All')",
            );
            drawers.sidebarAll = await control(
              all,
              "Mutually exclusive Sidebar All",
              true,
            );
            await tap('[aria-label="Toggle Details"]', "Toggle Details", true);
            await waitFor(
              "document.querySelector('[data-slot=window]').hasAttribute('data-right-open')&&!document.querySelector('[data-slot=window]').hasAttribute('data-left-open')",
            );
            await tap('[aria-label="Toggle Details"]', "Toggle Details", true);
            await waitFor(
              "!document.querySelector('[data-slot=window]').hasAttribute('data-right-open')&&!document.querySelector('[data-slot=window]').hasAttribute('data-left-open')",
            );
            await prove(
              `coarse-${layout.width}-${layout.zoom}-drawers-start-closed-and-mutually-exclusive`,
            );
          }
          await libraryScreen();
          await tap('[aria-label="Toggle Sidebar"]', "Toggle Sidebar", true);
          await waitFor(
            "document.querySelector('[data-slot=window]').hasAttribute('data-left-open')",
          );
          const panel = await bounds("[data-slot=left][data-open]");
          assert.ok(
            panel && fit(panel),
            `Open Library sidebar must fit: ${JSON.stringify(panel)}`,
          );
          const all = await mark(
            '[role=navigation][aria-label="Library"] button',
            "Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()==='All')",
          );
          await tap(all, "Library All destination", true);
          await sidebar(false, true);
          const search = "[data-library-search]";
          await tap(search, "Library Search", true);
          await until(
            () =>
              run(
                "document.activeElement===document.querySelector('[data-library-search]')",
              ),
            "actual Search editing focus",
            2000,
          );
          await win.webContents.insertText(record.sample.title);
          await waitFor(
            `document.querySelector('[data-library-search]').textContent.trim()===${JSON.stringify(record.sample.title)}`,
          );
          const card = `[data-save-id="${record.sample.id}"] [role=option]`;
          await waitFor(
            `document.querySelector(${JSON.stringify(card)})&&document.querySelectorAll('[data-save-id] [role=option]').length===1`,
          );
          await run(
            "(()=>{window.__pwaSaveEvents=[];for(const type of ['pointerdown','pointerup','click','dblclick'])document.addEventListener(type,event=>{if(event.target.closest('[data-save-id]'))window.__pwaSaveEvents.push({type,trusted:event.isTrusted,pointerType:event.pointerType})},true)})()",
          );
          const box = await tap(card, "Read-only Save card", true);
          await pause(80);
          const secondTap = await bounds(card);
          assert.ok(
            secondTap && fit(secondTap) && secondTap.hit,
            "The second contact must still hit the same visible Save during the double-tap gesture.",
          );
          const point = {
            x: secondTap.left + secondTap.width / 2,
            y: secondTap.top + secondTap.height / 2,
            radiusX: 1,
            radiusY: 1,
            force: 1,
            id: 1,
          };
          await debug.sendCommand("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [point],
          });
          await debug.sendCommand("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await waitFor(
            `location.pathname==='/save/${record.sample.id}'&&document.querySelector('[data-save-details] [data-viewer-root]')`,
          );
          await tap(
            '[data-save-details] [aria-label="Fit to Window"]',
            "Fit to Window",
            true,
          );
          await waitFor(
            `Array.from(document.querySelectorAll('[data-save-details] img')).some(image=>image.complete&&image.naturalWidth===${record.sample.width}&&image.naturalHeight===${record.sample.height}&&image.src.includes('/web/media/${record.sample.id}/'))`,
          );
          const image = await run(
            `(()=>{const node=Array.from(document.querySelectorAll('[data-save-details] img')).find(image=>image.complete&&image.naturalWidth===${record.sample.width}&&image.naturalHeight===${record.sample.height}&&image.src.includes('/web/media/${record.sample.id}/'));const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,viewport:{width:innerWidth,height:innerHeight}}})()`,
          );
          assert.ok(
            fit(image) && image.width >= 80 && image.height >= 60,
            `Useful Save image must fit: ${JSON.stringify(image)}`,
          );
          const zoomControls = {};
          for (const label of ["Zoom Ratio", "Zoom Out", "Zoom In"])
            zoomControls[label] = await control(
              `[data-save-details] [aria-label="${label}"]`,
              label,
              true,
            );
          const zoomPill = zoomControls["Zoom Ratio"];
          await tap('[aria-label="Back"]', "Save Back", true);
          await waitFor(
            "location.pathname==='/'&&document.querySelector('[aria-label=\"Clear Search\"]')",
          );
          await tap('[aria-label="Clear Search"]', "Clear Search", true);
          await waitFor(
            "document.querySelector('[data-library-search]').textContent.trim()===''&&!document.querySelector('[aria-label=\"Clear Search\"]')",
          );
          const shell = await bounds("[data-slot=window]");
          assert.ok(
            fit(shell),
            `Library shell must fit: ${JSON.stringify(shell)}`,
          );
          const documentWidth = await run(
            "document.documentElement.scrollWidth",
          );
          assert.ok(
            documentWidth <= layout.width + 1,
            "The production shell must not create horizontal document scrolling.",
          );
          const events = await run("window.__pwaSaveEvents");
          assert.ok(
            events.some((event) => event.type === "dblclick" && event.trusted),
            "The Save must open through an actual double tap, not a direct route.",
          );
          assert.ok(
            events.some(
              (event) =>
                event.type === "pointerdown" &&
                event.trusted &&
                event.pointerType === "touch",
            ),
          );
          record.layouts.push({
            ...layout,
            sidebar: panel,
            card: box,
            image,
            shell,
            zoomPill,
            zoomControls,
            events,
            documentWidth,
          });
          await prove(
            `coarse-${layout.width}-${layout.zoom}-${layout.direction}-library-search-save`,
          );
        }

        await viewport(390, 850, "ltr", 100);
        await libraryScreen();
        try {
          await debug.sendCommand("Emulation.setSafeAreaInsetsOverride", {
            insets: { top: 24, right: 0, bottom: 16, left: 0 },
          });
          await pause(100);
          record.safeArea = await run(
            "(()=>{const style=getComputedStyle(document.body),r=document.querySelector('[data-slot=window]').getBoundingClientRect();return{top:Number.parseFloat(style.paddingTop),bottom:Number.parseFloat(style.paddingBottom),left:r.left,right:r.right,windowTop:r.top,windowBottom:r.bottom,viewportHeight:innerHeight}})()",
          );
          assert.ok(
            Math.abs(record.safeArea.top - 24) < 1 &&
              Math.abs(record.safeArea.bottom - 16) < 1,
            "Actual browser safe-area values must reach body layout.",
          );
          assert.ok(
            record.safeArea.windowTop >= 23 &&
              record.safeArea.windowBottom <= 835,
            "The useful shell must remain inside the simulated safe area.",
          );
          await prove("protocol-safe-area-layout");
        } catch (error) {
          if (!/wasn't found|not found|not supported/.test(error.message))
            throw error;
          record.safeArea = {
            unverified: true,
            reason:
              "This Chromium CDP build does not expose Emulation.setSafeAreaInsetsOverride.",
          };
        } finally {
          if (!record.safeArea?.unverified)
            await debug.sendCommand("Emulation.setSafeAreaInsetsOverride", {
              insets: {},
            });
        }
      } else {
        await viewport(390, 850, "ltr", 100);
        await libraryScreen();
      }
      await win.webContents.session.clearCache();
      const { targetInfo: pageTarget } = await debug.sendCommand(
        "Target.getTargetInfo",
      );
      const { targetInfos } = await debug.sendCommand("Target.getTargets");
      const workers = targetInfos.filter(
        (target) =>
          target.type === "service_worker" &&
          target.url === `${origin}/app-sw.js`,
      );
      assert.equal(
        workers.length,
        1,
        "Attach only the exact active app worker in the disposable browser instance.",
      );
      if (pageTarget.browserContextId)
        assert.equal(workers[0].browserContextId, pageTarget.browserContextId);
      workerSessionId = (
        await debug.sendCommand("Target.attachToTarget", {
          targetId: workers[0].targetId,
          flatten: true,
        })
      ).sessionId;
      record.workerTarget = {
        type: workers[0].type,
        url: workers[0].url,
        targetId: workers[0].targetId,
        sameBrowserContext:
          workers[0].browserContextId === pageTarget.browserContextId,
      };
      await debug.sendCommand("Network.enable", {}, workerSessionId);
      await debug.sendCommand(
        "Network.setCacheDisabled",
        { cacheDisabled: true },
        workerSessionId,
      );
      record.offlineTransport =
        "Disposable Electron session plus page AND exact app-sw.js CDP Network offline; HTTP cache cleared and disabled for both targets, CacheStorage unchanged.";
      await debug.sendCommand("Network.setCacheDisabled", {
        cacheDisabled: true,
      });
      await networkOnline(false);
      await win.loadURL(origin);
      record.offlineNavigation = record.navigations.at(-1);
      await waitFor(
        "document.querySelector('h2')?.textContent==='Reconnect to your Library' && document.querySelector('img')?.naturalWidth>0",
      );
      record.offlineNavigatorOnLine = await run("navigator.onLine");
      assert.ok(
        record.workerNetworkFailures.some(
          (failure) =>
            failure.path === "/" &&
            failure.offline &&
            failure.error === "net::ERR_INTERNET_DISCONNECTED",
        ),
        "The actual app worker navigation fetch must fail at the network transport, regardless of the OS connectivity signal.",
      );
      assert.equal(
        await run(
          "Boolean(document.querySelector('[data-slot=window],#host-key-file,[data-save-id]'))",
        ),
        false,
      );
      assert.match(
        await run("document.body.innerText"),
        /Connect to Tailscale/,
      );
      assert.match(
        await run("document.body.innerText"),
        /Your Library stays on your Mac/,
      );
      assert.equal(
        await run(
          "fetch('/web/session',{cache:'no-store'}).then(()=>false,()=>true)",
        ),
        true,
        "Authenticated session data must not be served from the offline cache.",
      );
      assert.equal(record.offlineNavigation.pathname, "/");
      assert.equal(
        record.offlineNavigation.fromServiceWorker,
        true,
        "The actual navigation must be served by the active service worker.",
      );
      const retry = await mark(
        "button",
        "node.textContent.trim()==='Try again'",
      );
      record.offlineButton = await run(
        `(()=>{const button=document.querySelector(${JSON.stringify(retry)}),style=getComputedStyle(button);return{variant:button.dataset.variant,background:style.backgroundColor,color:style.color,fontSize:style.fontSize,radius:style.borderRadius,icon:document.querySelector('img').src.startsWith('data:')}})()`,
      );
      assert.equal(record.offlineButton.variant, "primary");
      assert.equal(
        record.offlineButton.icon,
        true,
        "The offline icon must be self-contained.",
      );
      await control(retry, "Offline Try again", true);
      await prove("actual-network-offline-explanation");
      await networkOnline(true);
      await navigationBy(
        () => tap(retry, "Offline Try again", true),
        "Trusted offline Try again",
      );
      await waitFor(
        "document.querySelector('[data-slot=window]')&&!document.querySelector('#host-key-file')",
      );
      await waitFor(
        "!document.querySelector('[aria-label=\"Host connection\"]')",
      );
      await refreshSession();
      assert.equal((await session()).libraryId, libraryId);
      record.onlineSession = await run(
        "fetch('/web/session',{cache:'no-store'}).then(async response=>({status:response.status,session:response.ok?await response.json():null}))",
      );
      assert.equal(record.onlineSession.status, 200);
      assert.equal(record.onlineSession.session.libraryId, libraryId);
      assert.deepEqual(
        await inspectCaches(),
        record.caches,
        "Visiting the Library must not cache its authenticated data.",
      );
      await prove("online-reload-preserves-same-library-session");

      // Reauthentication is deliberately last; preceding checks do not depend on a logged-out client.
      await viewport(390, 850, "ltr", 100);
      await preferencesScreen();
      const disconnect = await mark(
        "button",
        "node.textContent.trim()==='Disconnect'",
      );
      await run(
        `document.querySelector(${JSON.stringify(disconnect)}).scrollIntoView({block:'nearest',inline:'nearest'})`,
      );
      await tap(disconnect, "Settings Disconnect", true);
      await waitFor(
        "Array.from(document.querySelectorAll('[role=dialog],[role=alertdialog]')).some(node=>node.textContent.includes('Disconnect This Browser?'))",
      );
      const cancel = await mark(
        "[role=dialog] button,[role=alertdialog] button",
        "node.textContent.trim()==='Cancel'",
      );
      await tap(cancel, "Disconnect Cancel", true);
      await waitFor(
        "!Array.from(document.querySelectorAll('[role=dialog],[role=alertdialog]')).some(node=>node.textContent.includes('Disconnect This Browser?'))",
      );
      assert.equal(
        record.sessionDeletes,
        0,
        "Cancel must not send a logout request.",
      );
      assert.equal((await session()).libraryId, libraryId);
      await prove("settings-disconnect-cancel-preserves-session");
      await tap(
        await mark("button", "node.textContent.trim()==='Disconnect'"),
        "Settings Disconnect",
        true,
      );
      const confirm = await mark(
        "[role=dialog] button,[role=alertdialog] button",
        "node.textContent.trim()==='Disconnect'",
      );
      await navigationBy(
        () => tap(confirm, "Disconnect Confirm", true),
        "Trusted Settings Disconnect Confirm",
      );
      await waitFor("document.querySelector('#host-key-file')");
      assert.equal(
        record.sessionDeletes,
        1,
        "Confirm must send exactly one real logout request.",
      );
      assert.equal(
        await run(
          "fetch('/web/session',{cache:'no-store'}).then(response=>response.status)",
        ),
        401,
      );
      await click("#connection-method");
      const login = await run(
        "(()=>{const form=document.querySelector('[aria-label=\"Host connection\"]'),r=form.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,viewport:{width:innerWidth,height:innerHeight}}})()",
      );
      assert.ok(
        fit(login),
        `The phone login screen must fit: ${JSON.stringify(login)}`,
      );
      record.loginControls = {
        input: await control("#host-key", "Access key input", true),
        connect: await control(
          await mark("button", "node.textContent.trim()==='Connect'"),
          "Connect",
          true,
        ),
        file: await control(
          'button[aria-label="Choose key file"]',
          "Access key file chooser",
          true,
        ),
      };
      await prove("settings-disconnect-confirm-phone-login");
      await keyFileLogin();
      await waitFor(
        "!document.querySelector('[aria-label=\"Host connection\"]')",
      );
      await prove("actual-key-file-reauth-same-library");
      assert.deepEqual(
        record.criticalTargetFailures,
        [],
        "Every measured critical coarse-pointer action must have a 44px target; see private geometry results.",
      );
    }
  } catch (error) {
    failure = error;
    record.failure = error.message;
    record.failureState = await run(
      "({url:location.href,online:navigator.onLine,ready:document.readyState,headings:Array.from(document.querySelectorAll('h1')).map(node=>node.textContent),bodyLength:document.body.innerHTML.length,appScript:Boolean(document.querySelector('script[type=module]')),controller:navigator.serviceWorker.controller?.scriptURL})",
    ).catch(() => null);
    saveRecord();
    await snapshot(`${record.runId}-failed`)
      .then(() => {
        for (const extension of ["png", "txt"])
          chmodSync(
            join(evidence, `${record.runId}-failed.${extension}`),
            0o600,
          );
      })
      .catch(() => {});
  } finally {
    restoring = true;
    const errors = [];
    const cleanup = async (name, action) => {
      try {
        await action();
      } catch (error) {
        errors.push(`${name}: ${error.message}`);
      }
    };
    await cleanup("Network online", () => networkOnline(true));
    await cleanup("Browser HTTP cache", () =>
      debug.sendCommand("Network.setCacheDisabled", { cacheDisabled: false }),
    );
    await cleanup("Worker HTTP cache", async () => {
      if (workerSessionId)
        await debug.sendCommand(
          "Network.setCacheDisabled",
          { cacheDisabled: false },
          workerSessionId,
        );
    });
    await cleanup("Safe-area override", async () => {
      if (record.safeArea && !record.safeArea.unverified)
        await debug.sendCommand("Emulation.setSafeAreaInsetsOverride", {
          insets: {},
        });
    });
    await cleanup("Authenticated recovery", async () => {
      await win.loadURL(origin);
      await waitFor(
        "document.querySelector('#host-key-file,[data-slot=window]')",
      );
      if (await run("Boolean(document.querySelector('#host-key-file'))"))
        await keyFileLogin();
      else await refreshSession();
      assert.equal((await session()).libraryId, libraryId);
    });
    await cleanup("Read-only Save", async () => {
      if (!record.sample) return;
      const current = await query("saves.get", { id: record.sample.id });
      assert.deepEqual(
        stableSave(current),
        record.sample.before,
        "PWA reading must preserve the selected Save's data and file list.",
      );
      assert.equal(
        digest(
          Buffer.from(
            await (await request(record.sample.mediaPath)).arrayBuffer(),
          ),
        ),
        record.sample.sha256,
      );
      record.sample.unchanged = true;
    });
    await cleanup("Device presentation", async () => {
      await debug.sendCommand("Emulation.setTouchEmulationEnabled", {
        enabled: false,
      });
      win.setContentSize(...originalSize);
      await press("Escape");
      await restoreStorage();
      await win.loadURL(origin);
      await waitFor("document.querySelector('[data-slot=window]')");
      await pause(250);
      await restoreStorage();
      assert.deepEqual(await storage(), originalStorage);
      assert.equal(await run("document.documentElement.dir"), originalDir);
    });
    await cleanup("Original Library and host preferences", async () => {
      assert.deepEqual(await query("library.info"), initial);
      assert.equal(json(join(initial.path, "metadata.json")).id, libraryId);
      assert.deepEqual(await query("settings.getPrefs"), originalPrefs);
      for (const pointer of pointers)
        assert.equal(readFileSync(pointer.path, "utf8"), pointer.content);
    });
    await cleanup("Revoke disposable browser session", async () => {
      const headers = await cookies();
      const revoked = await fetch(`${origin}/web/session`, {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(revoked.status, 200);
      const stale = await fetch(`${origin}/web/session`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(
        stale.status,
        401,
        "The disposable browser's session must be revoked after QA.",
      );
      record.ownSessionRevoked = true;
    });
    record.cleanupErrors = errors;
    record.cleaned = errors.length === 0;
    record.restored = errors.length === 0;
    saveRecord();
    if (workerSessionId)
      await debug.sendCommand("Target.detachFromTarget", {
        sessionId: workerSessionId,
      });
    debug.removeListener("message", onMessage);
    if (debug.isAttached()) debug.detach();
    if (!failure && errors.length)
      failure = new Error(`PWA shell cleanup failed: ${errors.join("; ")}`);
  }
  if (failure) throw failure;
  assert.equal(record.restored, true);
  assert.equal(record.cleaned, true);
  const scope = recoveryOnly
    ? "PWA recovery only"
    : rtlProbeOnly
      ? "PWA RTL geometry diagnostic"
      : connectionOnly
        ? "PWA connection subset"
        : "Production PWA shell";
  console.log(
    recoveryOnly
      ? `${scope}: original state restored and disposable session revoked; no acceptance cases rerun.`
      : `${scope}: ${record.checks.length} real checks passed; original Library, preferences, and device state restored.`,
  );
};
