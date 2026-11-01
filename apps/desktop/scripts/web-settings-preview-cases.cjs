const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
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
const sharp = require("sharp");

const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Only the existing host runs. Device zoom and owned fixtures are restored on every exit. */
exports.verifyBrowserSettingsPreview =
  async function verifyBrowserSettingsPreview({
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
    const recoveryOnly = process.argv.includes("--settings-preview-restore");
    const menuProbeOnly = process.argv.includes("--settings-menu-probe");
    const recordPath = join(evidence, "settings-preview-restore.json");
    const saved = recoveryOnly ? json(recordPath) : null;
    assert.match(
      win.webContents.session.getStoragePath() ?? "",
      /iris-browser-smoke-/,
      "Use only the disposable smoke browser profile.",
    );
    const original = saved?.original ?? (await query("library.info"));
    const originalId =
      saved?.originalId ?? json(join(original.path, "metadata.json")).id;
    assert.equal(json(join(original.path, "metadata.json")).id, originalId);
    const originalPrefs =
      saved?.originalPrefs ?? (await query("settings.getPrefs"));
    assert.equal(
      originalPrefs.autoImport.enabled,
      false,
      "The personal watched folder must be disabled before fixture transitions.",
    );
    const localState = async () =>
      run(
        "Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]))",
      );
    const originalStorage = saved?.originalStorage ?? (await localState());
    const originalSize = saved?.originalSize ?? win.getContentSize();
    const originalPageZoom = win.webContents.getZoomFactor();
    assert.equal(
      originalPageZoom,
      1,
      "CSS zoom coordinates require an unzoomed test WebContents.",
    );
    const parent = dirname(resolve(original.path));
    const ownedName =
      saved?.ownedName ?? `Circe settings preview ${process.pid}-${Date.now()}`;
    const ownedPath = saved?.ownedPath ?? join(parent, `${ownedName}.pond`);
    const pointer = [
      join(sandbox, "app-data/library-location.json"),
      join(sandbox, "library-location.json"),
    ].find(existsSync);
    const record = saved ?? {
      original,
      originalId,
      originalPrefs,
      originalStorage,
      originalSize,
      ownedName,
      ownedPath,
      checks: {},
      geometry: [],
      hostRequests: [],
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
    const until = async (read, label, timeout = 30000) => {
      const end = restoring
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
        await pause(100);
      }
      throw new Error(`Settings/preview timed out: ${label}`, { cause });
    };
    const prove = async (name) => {
      record.checks[name] = true;
      saveRecord();
      const label = `settings-preview-${ownedName.split(" ").at(-1)}-${name}`;
      await snapshot(label);
      for (const extension of ["png", "txt"])
        chmodSync(join(evidence, `${label}.${extension}`), 0o600);
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
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(response.status, 200);
      return {
        cookie,
        origin,
        "x-iris-library": (await response.json()).libraryId,
      };
    };
    const api = async (route, body, filename) => {
      const requestHeaders = {
        ...(await headers()),
        "content-type": filename
          ? "application/octet-stream"
          : "application/json",
      };
      if (filename)
        requestHeaders["x-iris-filename"] = encodeURIComponent(filename);
      const response = await fetch(`${origin}/web/${route}`, {
        method: filename ? "PUT" : "POST",
        headers: requestHeaders,
        body: filename ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
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
      let current = roots
        .filter(
          (entry) =>
            resolve(path) === entry.path ||
            resolve(path).startsWith(`${entry.path}${sep}`),
        )
        .sort((a, b) => b.path.length - a.path.length)[0];
      assert.ok(current);
      for (const name of relative(current.path, resolve(path))
        .split(sep)
        .filter(Boolean)) {
        current = (
          await api("locations", {
            action: "list",
            purpose,
            handle: current.handle,
            filter: name,
            hidden: true,
          })
        ).entries.find((entry) => entry.name === name);
        assert.ok(current);
      }
      return current;
    };
    const instance = async () => {
      const response = await fetch(`${origin}/web/ready`, {
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      });
      assert.equal(response.status, 200);
      return (await response.json()).instance;
    };
    const debuggerApi = win.webContents.debugger;
    assert.equal(debuggerApi.isAttached(), false);
    debuggerApi.attach("1.3");
    await debuggerApi.sendCommand("Page.enable");
    await debuggerApi.sendCommand("Network.enable");
    await debuggerApi.sendCommand("Page.setInterceptFileChooserDialog", {
      enabled: true,
    });
    const observe = (_event, method, params) => {
      if (
        method !== "Network.requestWillBeSent" ||
        params.request.url !== `${origin}/web/query` ||
        !params.request.postData
      )
        return;
      const value = JSON.parse(params.request.postData);
      if (
        [
          "settings.setPrefs",
          "window.applyPrefs",
          "system.applyPrefs",
          "quickCapture.applyPrefs",
          "updates.checkNow",
          "saves.quickLook",
        ].includes(value.name)
      ) {
        record.hostRequests.push({
          name: value.name,
          params: value.params ?? {},
        });
        saveRecord();
      }
    };
    debuggerApi.on("message", observe);
    const connect = async (previous) => {
      if (previous)
        await until(
          async () => (await instance()) !== previous,
          "replacement host",
          60000,
        );
      await win.loadURL(origin);
      await until(
        () =>
          run(
            "Boolean(document.querySelector('#host-key-file,[data-slot=window],[data-library-search]'))",
          ),
        "login or app",
        60000,
      );
      if (await run("Boolean(document.querySelector('#host-key-file'))")) {
        let listener;
        let timer;
        const opened = new Promise((resolveChooser, reject) => {
          timer = setTimeout(
            () => reject(new Error("Actual access-key chooser did not open.")),
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
      await until(
        () =>
          run(
            "Boolean(document.querySelector('[data-slot=window],[data-library-search]'))",
          ),
        "authenticated app",
        60000,
      );
      await refreshSession({ allowLibraryChange: true });
      return query("library.info");
    };
    const transition = async (name, params) => {
      const previous = await instance();
      const started = Date.now();
      const response = await api("library", { name, params });
      assert.equal(response.ok, true);
      if (name === "library.createAt") {
        const stat = lstatSync(ownedPath);
        assert.equal(stat.isDirectory() && !stat.isSymbolicLink(), true);
        record.ownedId = json(join(ownedPath, "metadata.json")).id;
        record.ownedIdentity = { dev: stat.dev, ino: stat.ino };
        assert.notEqual(record.ownedId, originalId);
        saveRecord();
      }
      const timing = { name, requestMs: Date.now() - started };
      record.transitions.push(timing);
      saveRecord();
      const current = await connect(response.restarting ? previous : undefined);
      timing.reconnectedMs = Date.now() - started;
      saveRecord();
      return current;
    };
    const assertOwned = async () => {
      assert.equal((await query("library.info")).path, ownedPath);
      assert.ok(record.ownedId);
      assert.equal(json(join(ownedPath, "metadata.json")).id, record.ownedId);
      assert.notEqual(record.ownedId, originalId);
    };
    const removeUpload = async () => {
      if (!record.upload || record.uploadRemoved) return;
      await assertOwned();
      const response = await fetch(
        `${origin}/web/upload/${encodeURIComponent(record.upload)}`,
        {
          method: "DELETE",
          headers: await headers(),
          signal: AbortSignal.timeout(15000),
        },
      );
      assert.equal(response.status, 200);
      record.uploadRemoved = true;
      saveRecord();
    };
    const mark = async (selector, predicate) => {
      record.uiPhase = `${selector}: ${predicate}`;
      saveRecord();
      const find = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node=>node.getBoundingClientRect().width>0 && (${predicate}))`;
      await waitFor(`Boolean(${find})`);
      await run(
        `(()=>{document.querySelectorAll('[data-settings-preview-control]').forEach(node=>node.removeAttribute('data-settings-preview-control'));(${find}).setAttribute('data-settings-preview-control','target')})()`,
      );
      return '[data-settings-preview-control="target"]';
    };
    const exactLabel = (title) =>
      String.raw`node.getAttribute('aria-label')===${JSON.stringify(title)} || (node.getAttribute('aria-labelledby')||'').split(/\s+/).some(id=>document.getElementById(id)?.textContent.trim()===${JSON.stringify(title)})`;
    const press = async (keyCode) => {
      for (const type of ["keyDown", "keyUp"])
        win.webContents.sendInputEvent({ type, keyCode });
      await pause(30);
    };
    const geometry = async (selector) =>
      run(`(()=>{
    const node=document.querySelector(${JSON.stringify(selector)});if(!node)return null;
    const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,hit:Boolean(hit&&node.contains(hit)),label:node.getAttribute('aria-label'),active:document.activeElement===node};
  })()`);
    const assertControl = async (selector, touch = false) => {
      const bounds = await geometry(selector);
      assert.ok(bounds, selector);
      const viewport = await run("({width:innerWidth,height:innerHeight})");
      assert.ok(bounds.width > 0 && bounds.height > 0, `${selector} visible`);
      assert.ok(
        bounds.left >= -1 &&
          bounds.right <= viewport.width + 1 &&
          bounds.top >= -1 &&
          bounds.bottom <= viewport.height + 1,
        `${selector} must fit viewport: ${JSON.stringify(bounds)}`,
      );
      assert.equal(bounds.hit, true, `${selector} must receive pointer input`);
      if (touch)
        assert.ok(
          bounds.width >= 44 && bounds.height >= 44,
          "Quick Preview Close must remain a 44px touch target.",
        );
      return bounds;
    };
    const setViewport = async (width, height, coarse = false) => {
      win.setContentSize(width, height);
      await debuggerApi.sendCommand("Emulation.setTouchEmulationEnabled", {
        enabled: coarse,
        maxTouchPoints: 1,
      });
      await waitFor(
        `innerWidth===${width} && innerHeight===${height} && matchMedia('(pointer: coarse)').matches===${coarse}`,
      );
    };
    const touch = async (selector) => {
      const bounds = await assertControl(selector);
      const point = {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
        radiusX: 1,
        radiusY: 1,
        force: 1,
        id: 1,
      };
      await debuggerApi.sendCommand("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [point],
      });
      await debuggerApi.sendCommand("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    };
    const sidebar = async (open) => {
      await waitFor(
        "document.querySelector('[data-slot=window]') && document.querySelector('[aria-label=\"Toggle Sidebar\"]')",
      );
      const current = await run(
        "document.querySelector('[data-slot=window]')?.hasAttribute('data-left-open')",
      );
      if (current !== open) await click('[aria-label="Toggle Sidebar"]');
      await waitFor(
        `document.querySelector('[data-slot=window]')?.hasAttribute('data-left-open')===${open}`,
      );
    };
    const closePanels = async () => {
      await sidebar(false);
      if (
        await run(
          "document.querySelector('[data-slot=window]')?.hasAttribute('data-right-open')",
        )
      )
        await click('[aria-label="Toggle Details"]');
    };
    const libraryScreen = async () => {
      await win.loadURL(origin);
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
        "location.pathname==='/' && document.querySelector('[role=navigation][aria-label=\"Library\"]')",
      );
    };
    const preferencesScreen = async () => {
      await libraryScreen();
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
    };
    const browserPrefs = () => run("window.pond.query('settings.getPrefs',{})");
    const assertHostZoom = async () => {
      assert.equal(
        (await query("settings.getPrefs")).window.interfaceZoom,
        originalPrefs.window.interfaceZoom,
      );
      assert.equal(win.webContents.getZoomFactor(), originalPageZoom);
      assert.equal(
        record.hostRequests.some(
          (request) =>
            request.name === "settings.setPrefs" &&
            Object.hasOwn(request.params.window ?? {}, "interfaceZoom"),
        ),
        false,
        "Device zoom must never reach host preference persistence.",
      );
    };
    const setSlider = async (value) => {
      const selector = await mark(
        "input[type=range]",
        exactLabel("Interface Zoom"),
      );
      await run(
        `(()=>{document.querySelectorAll('[data-settings-preview-slider-thumb]').forEach(node=>node.removeAttribute('data-settings-preview-slider-thumb'));document.querySelector(${JSON.stringify(selector)}).parentElement.setAttribute('data-settings-preview-slider-thumb','true')})()`,
      );
      const thumb = '[data-settings-preview-slider-thumb="true"]';
      await click(thumb);
      await waitFor(
        `document.activeElement===document.querySelector(${JSON.stringify(selector)})`,
      );
      const current = Number(
        await run(
          `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-valuenow')`,
        ),
      );
      assert.equal(Math.abs(value - current) % 5, 0);
      for (let step = 0; step < Math.abs(value - current) / 5; step++)
        await press(value > current ? "Right" : "Left");
      await until(
        async () => (await browserPrefs()).window.interfaceZoom === value,
        "actual Interface Zoom slider saved",
      );
      await waitFor(
        `Math.abs(Number(getComputedStyle(document.body).zoom)-${value / 100})<0.001`,
      );
      await assertHostZoom();
      const layout = await run(
        `(()=>{const r=document.querySelector('[data-slot=window]').getBoundingClientRect();return {zoom:getComputedStyle(document.body).zoom,width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,windowHeight:r.height}})()`,
      );
      record.geometry.push({ kind: "settings", value, ...layout });
      saveRecord();
      assert.ok(
        layout.left >= -2 &&
          layout.right <= layout.width + 2 &&
          layout.top >= -2 &&
          layout.bottom <= layout.height + 2,
        `Zoomed app must fit viewport: ${JSON.stringify(layout)}`,
      );
      assert.ok(
        layout.documentWidth <= layout.width + 2,
        "Interface zoom must not introduce document horizontal overflow.",
      );
      assert.ok(
        layout.windowHeight > layout.height * 0.4,
        "Zoom must retain a useful app viewport.",
      );
      await assertControl(thumb);
    };
    const assertImage = async (selector) => {
      const matches = `image.complete&&image.naturalWidth===640&&new URL(image.src).pathname.includes('/web/media/${record.fixture.id}/')&&image.getBoundingClientRect().width>=80`;
      await waitFor(
        `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(image=>${matches})`,
      );
      const image = await run(
        `(()=>{const image=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(image=>${matches});const r=image.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,viewport:{width:innerWidth,height:innerHeight}}})()`,
      );
      assert.equal(image.naturalWidth, 640);
      assert.equal(image.naturalHeight, 480);
      assert.ok(
        image.width >= 80 && image.height >= 60,
        "The image must have useful rendered area.",
      );
      assert.ok(
        image.left >= -1 &&
          image.right <= image.viewport.width + 1 &&
          image.top >= -1 &&
          image.bottom <= image.viewport.height + 1,
        `Fit image must remain visible: ${JSON.stringify(image)}`,
      );
      return image;
    };
    const selectOwnedCard = async () => {
      await libraryScreen();
      await closePanels();
      const card = `[data-save-id="${record.fixture.id}"] [role=option]`;
      await waitFor(`document.querySelector(${JSON.stringify(card)})`);
      await click(card);
      await waitFor(
        "document.activeElement?.closest('[data-save-collection]') || document.activeElement?.closest('[data-save-id]')",
      );
      await run(
        `(()=>{window.__settingsPreviewKeys=[];for(const type of ['keydown','keyup','blur'])window.addEventListener(type,event=>{if(type==='blur'||event.code==='Space')window.__settingsPreviewKeys.push({type,code:event.code,trusted:event.isTrusted,hasFocus:document.hasFocus()})},true)})()`,
      );
    };
    const keyEvidence = async (name) => {
      record.keyboard ??= {};
      record.keyboard[name] = await run("window.__settingsPreviewKeys");
      saveRecord();
      return record.keyboard[name];
    };
    const openQuickPreview = async () => {
      await selectOwnedCard();
      await press("Space");
      await waitFor("document.querySelector('[data-quick-preview]')");
      assert.equal((await browserPrefs()).viewer.spaceAction, "quick-look");
      assert.equal(
        record.hostRequests.some(
          (request) => request.name === "saves.quickLook",
        ),
        false,
        "Imported macOS Quick Look must use the browser Quick Preview owner.",
      );
      assert.equal(
        await run(
          "/This action needs the Circé desktop host|Couldn't Open Quick Look/.test(document.body.innerText)",
        ),
        false,
      );
      const image = await assertImage("[data-quick-preview] img");
      const dialog = await geometry("[data-quick-preview]");
      const viewport = await run(
        "({width:innerWidth,height:innerHeight,zoom:getComputedStyle(document.body).zoom})",
      );
      record.dialogs ??= [];
      record.dialogs.push({ ...viewport, bounds: dialog });
      saveRecord();
      assert.ok(
        dialog.left >= -1 &&
          dialog.right <= viewport.width + 1 &&
          dialog.top >= -1 &&
          dialog.bottom <= viewport.height + 1,
        `Quick Preview dialog must fit the actual zoomed viewport: ${JSON.stringify({ dialog, viewport })}`,
      );
      return image;
    };
    const setSpaceBehavior = async (behavior) => {
      await preferencesScreen();
      await click(
        await mark(
          '[role=navigation][aria-label="Settings"] button',
          "Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()==='Preview')",
        ),
      );
      await waitFor("location.pathname==='/settings/viewer'");
      await click(
        await mark("[role=combobox]", exactLabel("Spacebar Preview")),
      );
      const label =
        behavior === "hold" ? "Hold to Preview" : "Press to Open or Close";
      await click(
        await mark(
          "[role=option]",
          `node.textContent.trim()===${JSON.stringify(label)}`,
        ),
      );
      await until(
        async () => (await browserPrefs()).viewer.spaceBehavior === behavior,
        "actual Spacebar Preview setting persisted",
      );
      assert.equal((await browserPrefs()).viewer.spaceAction, "quick-look");
    };
    const inspectFullViewer = async (width) => {
      await win.loadURL(`${origin}/save/${record.fixture.id}`);
      await closePanels();
      await waitFor(
        "document.querySelector('[data-save-details] [data-viewer-root]')",
      );
      await touch('[data-save-details] [aria-label="Fit to Window"]');
      const image = await assertImage("[data-save-details] img");
      const controls = await run(
        "Array.from(document.querySelectorAll('[data-save-details] [data-viewer-root] button[aria-label]')).filter(node=>node.getBoundingClientRect().width>0 && getComputedStyle(node).visibility!=='hidden').map(node=>{const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {label:node.getAttribute('aria-label'),disabled:node.disabled||node.getAttribute('aria-disabled')==='true',left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,hit:Boolean(hit&&node.contains(hit))}})",
      );
      assert.ok(controls.some((control) => control.label === "Fit to Window"));
      assert.ok(controls.some((control) => control.label === "Zoom Ratio"));
      for (const control of controls) {
        assert.ok(
          control.left >= -1 &&
            control.right <= width + 1 &&
            control.top >= -1 &&
            control.bottom <= 851,
          `${width}: ${control.label} must fit`,
        );
        if (!control.disabled)
          assert.equal(
            control.hit,
            true,
            `${width}: ${control.label} must receive pointer input`,
          );
      }
      return { image, controls };
    };
    let failure;
    try {
      if (menuProbeOnly) {
        await setViewport(1280, 900);
        await run(
          `(()=>{const key=${JSON.stringify(`iris:device-prefs:${originalId}`)},stored=JSON.parse(localStorage.getItem(key)||'{}');localStorage.setItem(key,JSON.stringify({...stored,window:{...stored.window,interfaceZoom:150}}))})()`,
        );
        await libraryScreen();
        await waitFor("Number(getComputedStyle(document.body).zoom)===1.5");
        const trigger = '[aria-label="Library Menu"]';
        await assertControl(trigger);
        const physicalClick = async (selector) => {
          win.focus();
          win.webContents.focus();
          await waitFor("document.hasFocus()");
          const bounds = await assertControl(selector);
          const point = {
            x: Math.round(bounds.left + bounds.width / 2),
            y: Math.round(bounds.top + bounds.height / 2),
          };
          win.webContents.sendInputEvent({ type: "mouseMove", ...point });
          for (const type of ["mouseDown", "mouseUp"])
            win.webContents.sendInputEvent({
              type,
              button: "left",
              clickCount: 1,
              ...point,
            });
        };
        const observeMenuInputs = () =>
          run(
            "(()=>{window.__settingsMenuProbeEvents=[];for(const type of ['pointerdown','pointerup','click','wheel'])document.addEventListener(type,event=>window.__settingsMenuProbeEvents.push({type,trusted:event.isTrusted,x:event.clientX,y:event.clientY,label:event.target.closest?.('[aria-label]')?.getAttribute('aria-label')}),true)})()",
          );
        await observeMenuInputs();
        await physicalClick(trigger);
        const settings = await mark(
          "[role=menuitem]",
          "Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()==='Settings')",
        );
        const describeMenu = () =>
          run(`(()=>{
          const describe=node=>{if(!node)return null;const r=node.getBoundingClientRect(),s=getComputedStyle(node);return {tag:node.tagName,role:node.getAttribute('role'),type:node.getAttribute('data-type'),attributes:Object.fromEntries(Array.from(node.attributes).filter(attr=>attr.name!=='style').map(attr=>[attr.name,attr.value])),bodyDirectChild:node.parentElement===document.body,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,scrollTop:node.scrollTop,scrollLeft:node.scrollLeft,offsetHeight:node.offsetHeight,maxHeight:s.maxHeight,heightStyle:s.height,overflow:s.overflow,overflowY:s.overflowY,position:s.position,transform:s.transform,zoom:s.zoom,availableHeight:s.getPropertyValue('--available-height'),availableWidth:s.getPropertyValue('--available-width'),anchorHeight:s.getPropertyValue('--anchor-height'),inlineStyle:node.getAttribute('style')?.slice(0,1000)}};
          const target=document.querySelector(${JSON.stringify(settings)}),menu=target?.closest('[role=menu]'),ancestors=[];for(let node=menu?.parentElement;node&&ancestors.length<7;node=node.parentElement)ancestors.push(describe(node));
          return {width:innerWidth,height:innerHeight,path:location.pathname,bodyZoom:getComputedStyle(document.body).zoom,target:describe(target),menu:describe(menu),ancestors,scroll:{html:describe(document.documentElement),body:describe(document.body),root:describe(document.getElementById('root')),window:describe(document.querySelector('[data-slot=window]'))}};
        })()`);
        record.menuProbe = { beforeHelper: await describeMenu() };
        saveRecord();
        await snapshot("settings-menu-probe-before-helper");
        const target = record.menuProbe.beforeHelper.target;
        if (
          target.top >= 0 &&
          target.bottom <= 900 &&
          (await geometry(settings)).hit
        ) {
          await physicalClick(settings);
          await waitFor("location.pathname.startsWith('/settings')");
          record.menuProbe.physicalClickWithoutScroll = true;
          record.menuProbe.firstEvents = await run(
            "window.__settingsMenuProbeEvents",
          );
          await libraryScreen();
          await observeMenuInputs();
          await physicalClick(trigger);
          await mark(
            "[role=menuitem]",
            "Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()==='Settings')",
          );
          record.menuProbe.beforeExactHelperScroll = await describeMenu();
          await run(
            `document.querySelector(${JSON.stringify(settings)}).scrollIntoView({block:'nearest',inline:'nearest'})`,
          );
          record.menuProbe.afterExactHelperScroll = await describeMenu();
          await snapshot("settings-menu-probe-after-helper-scroll");
          await assertControl(settings);
          const switchLibrary = await mark(
            "[role=menuitem]",
            "Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()==='Switch Library')",
          );
          await physicalClick(switchLibrary);
          await waitFor(
            "Array.from(document.querySelectorAll('[role=menu]')).filter(node=>node.getBoundingClientRect().width>0).length>=2",
          );
          record.menuProbe.nestedMenus = await run(
            "Array.from(document.querySelectorAll('[role=menu]')).filter(node=>node.getBoundingClientRect().width>0).map(node=>{const r=node.getBoundingClientRect();const ancestors=[];for(let parent=node.parentElement;parent&&ancestors.length<4;parent=parent.parentElement)ancestors.push({tag:parent.tagName,portal:parent.hasAttribute('data-base-ui-portal'),contained:parent.hasAttribute('data-contained'),position:getComputedStyle(parent).position,height:parent.getBoundingClientRect().height});return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,ancestors}})",
          );
          for (const menu of record.menuProbe.nestedMenus)
            assert.ok(
              menu.left >= -1 &&
                menu.right <= 1281 &&
                menu.top >= -1 &&
                menu.bottom <= 901,
              `Nested menu must fit150%viewport: ${JSON.stringify(menu)}`,
            );
          await snapshot("settings-menu-probe-nested");
        } else {
          record.menuProbe.physicalClickWithoutScroll = false;
          const bounds = record.menuProbe.beforeHelper.menu;
          const point = {
            x: Math.round(
              Math.max(1, Math.min(1278, bounds.left + bounds.width / 2)),
            ),
            y: Math.round(
              Math.max(1, Math.min(898, bounds.top + bounds.height / 2)),
            ),
          };
          win.webContents.sendInputEvent({ type: "mouseMove", ...point });
          win.webContents.sendInputEvent({
            type: "mouseWheel",
            deltaX: 0,
            deltaY: -600,
            canScroll: true,
            ...point,
          });
          await pause(200);
          record.menuProbe.afterPhysicalWheel = await describeMenu();
          await snapshot("settings-menu-probe-after-physical-wheel");
        }
        record.menuProbe.events = await run("window.__settingsMenuProbeEvents");
        saveRecord();
        await press("Escape");
        assert.equal(
          record.menuProbe.physicalClickWithoutScroll,
          true,
          "The natural150%menu must allow a real Settings click before helper scrolling.",
        );
      } else if (!recoveryOnly) {
        assert.equal(existsSync(ownedPath), false);
        await transition("library.createAt", {
          parent: (await location(parent, "parent")).handle,
          name: ownedName,
        });
        await assertOwned();
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
        const pixels = Buffer.alloc(640 * 480 * 3);
        for (let y = 0; y < 480; y++)
          for (let x = 0; x < 640; x++) {
            const offset = (y * 640 + x) * 3;
            pixels[offset] = x < 320 ? 220 : 30;
            pixels[offset + 1] = y < 240 ? 80 : 200;
            pixels[offset + 2] = x < 320 ? 30 : 230;
          }
        const bytes = await sharp(pixels, {
          raw: { width: 640, height: 480, channels: 3 },
        })
          .png()
          .toBuffer();
        record.fixture = {
          title: `Settings preview ${randomUUID()}`,
          sha256: sha(bytes),
        };
        saveRecord();
        record.upload = (
          await api("upload", bytes, "Settings preview 水.png")
        ).token;
        saveRecord();
        const created = await api("files", {
          name: "saves.createManual",
          params: { title: record.fixture.title, filePaths: [record.upload] },
        });
        assert.equal(created.ok, true);
        record.fixture.id = created.id;
        record.fixture.sourceId = `web-upload:${record.upload.slice("iris-upload:".length)}`;
        saveRecord();
        await until(
          async () =>
            (await query("saves.get", { id: created.id }))?.status ===
            "complete",
          "owned image imported",
        );
        await removeUpload();
        const canvas = await query("canvases.create", {
          name: `Zoom coordinate ${randomUUID()}`,
        });
        record.canvas = {
          id: canvas.id,
          name: canvas.name,
          itemId: randomUUID(),
        };
        saveRecord();
        await query("canvases.update", {
          id: canvas.id,
          expectedContent: canvas.contentVersion,
          content: {
            viewport: { x: 80, y: 60, zoom: 1 },
            connectors: [],
            items: [
              {
                id: record.canvas.itemId,
                kind: "figure",
                x: 120,
                y: 96,
                width: 200,
                height: 160,
                outline: "rectangle",
                color: "blue",
                text: "Owned drag fixture",
              },
            ],
          },
        });
        const ownedPrefs = await query("settings.getPrefs");
        record.deviceKey = `iris:device-prefs:${record.ownedId}`;
        await run(
          `localStorage.setItem(${JSON.stringify(record.deviceKey)},JSON.stringify(${JSON.stringify({ viewer: { ...ownedPrefs.viewer, spaceAction: "quick-look", spaceBehavior: "toggle", doubleClickAction: "open" }, window: { interfaceZoom: 100 }, shortcuts: { profile: "pond", overrides: {} } })}))`,
        );
        await setViewport(1280, 900);
        await preferencesScreen();
        await waitFor(
          "['Host Startup','Host System','Host Desktop Window','Browser'].every(text=>document.body.innerText.includes(text))",
        );
        const beforeApply = (await query("settings.getPrefs")).window;
        assert.equal(
          (await run("window.pond.query('window.applyPrefs',{})")).ok,
          true,
        );
        assert.deepEqual(
          (await query("settings.getPrefs")).window,
          beforeApply,
        );
        await click(
          await mark("button", "node.textContent.trim()==='Check Now'"),
        );
        await waitFor(
          "document.body.innerText.includes('This host runs from source. Updates are applied when the Circé host is rebuilt.')",
        );
        assert.ok(
          record.hostRequests.some(
            (request) => request.name === "updates.checkNow",
          ),
        );
        await prove("host-labels-same-value-window-apply-and-source-updater");

        await setSlider(150);
        await prove("interface-slider-150-device-only-fit");
        await win.loadURL(win.webContents.getURL());
        await waitFor("document.querySelector('input[type=range]')");
        assert.equal((await browserPrefs()).window.interfaceZoom, 150);
        await assertHostZoom();
        await waitFor("Number(getComputedStyle(document.body).zoom)===1.5");
        await prove("interface-150-reload-persistence");

        await libraryScreen();
        await click(
          await mark(
            '[role=navigation][aria-label="Library"] button',
            `Array.from(node.querySelectorAll('span')).some(label=>label.textContent.trim()===${JSON.stringify(record.canvas.name)})`,
          ),
        );
        await waitFor(
          `location.pathname==='/canvas/${record.canvas.id}' && document.querySelector('.react-flow__node[data-id="${record.canvas.itemId}"]')`,
        );
        await closePanels();
        await click('[aria-label="Select"]');
        const nodeSelector = `.react-flow__node[data-id="${record.canvas.itemId}"]`;
        const beforeCanvas = await query("canvases.get", {
          id: record.canvas.id,
        });
        const beforeItem = beforeCanvas.items[0];
        const beforeBox = await geometry(nodeSelector);
        assert.ok(beforeBox);
        const scale = beforeBox.width / beforeItem.width;
        assert.ok(
          Math.abs(scale - 1.5) < 0.03,
          "The Canvas probe must actually be rendered at 150% CSS zoom with unit board zoom.",
        );
        const from = {
          x: Math.round(beforeBox.left + beforeBox.width * 0.3),
          y: Math.round(beforeBox.top + beforeBox.height * 0.3),
        };
        // The native owner snaps to24world units; use a grid-aligned gesture rather than an impossible64unit result.
        const delta = { x: 108, y: 72 };
        const to = { x: from.x + delta.x, y: from.y + delta.y };
        await click(nodeSelector);
        assert.equal(
          await run(
            `document.querySelector(${JSON.stringify(nodeSelector)}).contains(document.elementFromPoint(${from.x},${from.y}))`,
          ),
          true,
          "The physical drag must start on the owned tile.",
        );
        await run(
          `(()=>{window.__settingsPreviewDrag=[];const node=document.querySelector(${JSON.stringify(nodeSelector)});for(const type of ['pointerdown','pointermove','pointerup'])document.addEventListener(type,event=>{if(node.contains(event.target)||window.__settingsPreviewDrag.length)window.__settingsPreviewDrag.push({type,x:event.clientX,y:event.clientY,trusted:event.isTrusted})},true)})()`,
        );
        win.webContents.sendInputEvent({ type: "mouseMove", ...from });
        win.webContents.sendInputEvent({
          type: "mouseDown",
          button: "left",
          clickCount: 1,
          ...from,
        });
        try {
          const activation = { x: from.x + 3, y: from.y + 3 };
          win.webContents.sendInputEvent({
            type: "mouseMove",
            button: "left",
            modifiers: ["leftButtonDown"],
            ...activation,
          });
          await waitFor(
            `document.querySelector(${JSON.stringify(nodeSelector)})?.classList.contains('dragging')`,
          );
          record.canvas.activation = {
            point: activation,
            box: await geometry(nodeSelector),
          };
          saveRecord();
          assert.ok(
            Math.abs(record.canvas.activation.box.left - beforeBox.left) <= 1 &&
              Math.abs(record.canvas.activation.box.top - beforeBox.top) <= 1,
            "The small physical activation must retain the initial native snapped frame.",
          );
          for (let step = 1; step <= 12; step++) {
            win.webContents.sendInputEvent({
              type: "mouseMove",
              button: "left",
              modifiers: ["leftButtonDown"],
              x: Math.round(from.x + (delta.x * step) / 12),
              y: Math.round(from.y + (delta.y * step) / 12),
            });
            await pause(16);
          }
        } finally {
          win.webContents.sendInputEvent({
            type: "mouseUp",
            button: "left",
            clickCount: 1,
            ...to,
          });
        }
        const afterCanvas = await until(async () => {
          const current = await query("canvases.get", { id: record.canvas.id });
          return current.items[0].x !== beforeItem.x && current;
        }, "real dragged Canvas autosaved");
        const afterItem = afterCanvas.items[0];
        const afterBox = await geometry(nodeSelector);
        record.canvas.drag = {
          before: beforeItem,
          after: afterItem,
          beforeBox,
          afterBox,
          physicalDelta: delta,
          scale,
          events: await run("window.__settingsPreviewDrag"),
        };
        saveRecord();
        assert.equal(beforeItem.x, 120);
        assert.equal(beforeItem.y, 96);
        assert.equal(
          afterItem.x,
          192,
          "Native grid-aligned X must move exactly72world units.",
        );
        assert.equal(
          afterItem.y,
          144,
          "Native grid-aligned Y must move exactly48world units.",
        );
        assert.ok(
          Math.abs(afterItem.x - beforeItem.x - delta.x / scale) <= 2,
          "Physical drag X must map to Canvas world coordinates exactly once through interface zoom.",
        );
        assert.ok(
          Math.abs(afterItem.y - beforeItem.y - delta.y / scale) <= 2,
          "Physical drag Y must map to Canvas world coordinates exactly once through interface zoom.",
        );
        assert.ok(
          Math.abs(afterBox.left - beforeBox.left - delta.x) <= 3 &&
            Math.abs(afterBox.top - beforeBox.top - delta.y) <= 3,
          "The tile must stay under the physical pointer.",
        );
        assert.ok(
          record.canvas.drag.events.some(
            (event) => event.type === "pointerdown" && event.trusted,
          ),
        );
        assert.ok(
          record.canvas.drag.events.some(
            (event) => event.type === "pointerup" && event.trusted,
          ),
        );
        await win.loadURL(win.webContents.getURL());
        await waitFor(
          `document.querySelector(${JSON.stringify(nodeSelector)})`,
        );
        assert.deepEqual(
          (await query("canvases.get", { id: record.canvas.id })).items,
          afterCanvas.items,
        );
        await prove("canvas-150-physical-drag-world-and-reload");

        await waitFor(
          "document.querySelector('[aria-label=\"Zoom 100%. Zoom to Fit\"]')",
        );
        const cameraBefore = await query("canvases.get", {
          id: record.canvas.id,
        });
        assert.equal(
          cameraBefore.viewport.zoom,
          1,
          "Interface150% must persist the Library's logical100% camera.",
        );
        const beforePanBox = await geometry(nodeSelector);
        await click('[aria-label="Hand"]');
        const pane = await geometry(".react-flow__pane");
        assert.ok(pane);
        const panFrom = {
          x: Math.round(pane.left + 60),
          y: Math.round(pane.top + 80),
        };
        const panDelta = { x: 90, y: 60 };
        const panTo = { x: panFrom.x + panDelta.x, y: panFrom.y + panDelta.y };
        assert.equal(
          await run(
            `document.elementFromPoint(${panFrom.x},${panFrom.y})?.classList.contains('react-flow__pane')`,
          ),
          true,
          "Pan must start on the actual empty Canvas surface.",
        );
        await run(
          "(()=>{window.__settingsPreviewPan=[];for(const type of ['pointerdown','pointermove','pointerup'])document.addEventListener(type,event=>window.__settingsPreviewPan.push({type,x:event.clientX,y:event.clientY,trusted:event.isTrusted}),true)})()",
        );
        win.webContents.sendInputEvent({ type: "mouseMove", ...panFrom });
        win.webContents.sendInputEvent({
          type: "mouseDown",
          button: "left",
          clickCount: 1,
          ...panFrom,
        });
        try {
          for (let step = 1; step <= 12; step++) {
            win.webContents.sendInputEvent({
              type: "mouseMove",
              button: "left",
              modifiers: ["leftButtonDown"],
              x: Math.round(panFrom.x + (panDelta.x * step) / 12),
              y: Math.round(panFrom.y + (panDelta.y * step) / 12),
            });
            await pause(16);
          }
        } finally {
          win.webContents.sendInputEvent({
            type: "mouseUp",
            button: "left",
            clickCount: 1,
            ...panTo,
          });
        }
        const cameraAfter = await until(async () => {
          const current = await query("canvases.get", { id: record.canvas.id });
          return current.viewport.x !== cameraBefore.viewport.x && current;
        }, "physical Hand pan persisted its logical camera");
        const afterPanBox = await geometry(nodeSelector);
        record.canvas.pan = {
          before: cameraBefore.viewport,
          after: cameraAfter.viewport,
          beforeBox: beforePanBox,
          afterBox: afterPanBox,
          physicalDelta: panDelta,
          events: await run("window.__settingsPreviewPan"),
        };
        saveRecord();
        assert.deepEqual(
          cameraAfter.items,
          cameraBefore.items,
          "Panning must leave world item frames unchanged.",
        );
        assert.equal(cameraAfter.viewport.zoom, 1);
        assert.ok(
          Math.abs(
            cameraAfter.viewport.x -
              cameraBefore.viewport.x -
              panDelta.x / scale,
          ) <= 1 &&
            Math.abs(
              cameraAfter.viewport.y -
                cameraBefore.viewport.y -
                panDelta.y / scale,
            ) <= 1,
          "Persisted camera must normalize physical pan once through interface scale.",
        );
        assert.ok(
          Math.abs(afterPanBox.left - beforePanBox.left - panDelta.x) <= 3 &&
            Math.abs(afterPanBox.top - beforePanBox.top - panDelta.y) <= 3,
          "Panned tile must follow the physical pointer.",
        );
        assert.ok(
          record.canvas.pan.events.some(
            (event) => event.type === "pointerdown" && event.trusted,
          ),
        );
        assert.ok(
          record.canvas.pan.events.some(
            (event) => event.type === "pointerup" && event.trusted,
          ),
        );
        await win.loadURL(win.webContents.getURL());
        await waitFor(
          `document.querySelector(${JSON.stringify(nodeSelector)}) && document.querySelector('[aria-label="Zoom 100%. Zoom to Fit"]')`,
        );
        const reloadedCamera = await query("canvases.get", {
          id: record.canvas.id,
        });
        assert.deepEqual(reloadedCamera.viewport, cameraAfter.viewport);
        assert.deepEqual(reloadedCamera.items, cameraAfter.items);
        const reloadedPanBox = await geometry(nodeSelector);
        assert.ok(
          Math.abs(reloadedPanBox.left - afterPanBox.left) <= 3 &&
            Math.abs(reloadedPanBox.top - afterPanBox.top) <= 3,
          "Reload must retain the same physical camera position at150%.",
        );
        await prove("canvas-150-physical-pan-logical-camera-reload");

        await preferencesScreen();
        await setSlider(100);
        await prove("interface-slider-100-restores-fit");
        const image = await openQuickPreview();
        await press("Space");
        await waitFor("!document.querySelector('[data-quick-preview]')");
        const toggles = await keyEvidence("second-space");
        assert.equal(
          toggles.filter(
            (event) =>
              event.type === "keydown" &&
              event.code === "Space" &&
              event.trusted,
          ).length,
          2,
        );
        assert.equal(
          toggles.filter(
            (event) =>
              event.type === "keyup" && event.code === "Space" && event.trusted,
          ).length,
          2,
        );
        await prove("imported-quick-look-second-space-closes");
        await openQuickPreview();
        await assertControl('[data-quick-preview] [aria-label="Close"]', true);
        await click('[data-quick-preview] [aria-label="Close"]');
        await waitFor("!document.querySelector('[data-quick-preview]')");
        await openQuickPreview();
        await press("Escape");
        await waitFor("!document.querySelector('[data-quick-preview]')");
        record.geometry.push({ kind: "quick-preview-desktop", image });
        await prove(
          "imported-quick-look-space-uses-shared-preview-close-escape",
        );

        await setSpaceBehavior("hold");
        await selectOwnedCard();
        win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
        try {
          await waitFor("document.querySelector('[data-quick-preview]')");
          await assertImage("[data-quick-preview] img");
        } finally {
          win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
        }
        await waitFor("!document.querySelector('[data-quick-preview]')");
        const held = await keyEvidence("hold-keyup");
        assert.ok(
          held.some(
            (event) =>
              event.type === "keydown" &&
              event.code === "Space" &&
              event.trusted,
          ),
        );
        assert.ok(
          held.some(
            (event) =>
              event.type === "keyup" && event.code === "Space" && event.trusted,
          ),
        );
        await prove("imported-quick-look-hold-keyup-closes");
        await selectOwnedCard();
        win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
        try {
          await waitFor("document.querySelector('[data-quick-preview]')");
          await assertImage("[data-quick-preview] img");
          win.blur();
          await waitFor(
            "!document.hasFocus() && !document.querySelector('[data-quick-preview]')",
          );
          const blurred = await keyEvidence("hold-blur");
          assert.ok(
            blurred.some(
              (event) =>
                event.type === "blur" && event.trusted && !event.hasFocus,
            ),
            "Actual test-window blur must dismiss held preview before keyup.",
          );
        } finally {
          win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
        }
        await prove("imported-quick-look-hold-native-blur-closes");
        await setSpaceBehavior("toggle");

        for (const width of [320, 390, 768]) {
          await setViewport(width, 850, true);
          const rendered = await openQuickPreview();
          const close = await assertControl(
            '[data-quick-preview] [aria-label="Close"]',
            true,
          );
          await press("Tab");
          assert.equal(
            await run(
              "document.querySelector('[data-quick-preview] [aria-label=\"Close\"]')===document.activeElement",
            ),
            true,
            "The explicit Close action must receive keyboard focus.",
          );
          await touch('[data-quick-preview] [aria-label="Close"]');
          await waitFor("!document.querySelector('[data-quick-preview]')");
          const viewer = await inspectFullViewer(width);
          record.geometry.push({
            kind: "coarse-preview-and-viewer",
            width,
            quickImage: rendered,
            close,
            viewer,
          });
          saveRecord();
          await prove(`coarse-${width}-quick-close-touch-image-toolbar-fit`);
        }

        await setViewport(1280, 900);
        await preferencesScreen();
        await setSlider(200);
        await prove("interface-slider-200-app-fit");
        await setViewport(390, 850, true);
        const zoomed = await openQuickPreview();
        await assertControl('[data-quick-preview] [aria-label="Close"]', true);
        await touch('[data-quick-preview] [aria-label="Close"]');
        await waitFor("!document.querySelector('[data-quick-preview]')");
        record.geometry.push({
          kind: "coarse-390-interface200-preview",
          image: zoomed,
          viewer: await inspectFullViewer(390),
        });
        await prove("coarse-390-interface200-quick-preview-image-toolbar-fit");
        await setViewport(1280, 900);
        await preferencesScreen();
        await setSlider(100);
        await assertHostZoom();
        assert.equal(
          record.hostRequests.some((request) =>
            ["system.applyPrefs", "quickCapture.applyPrefs"].includes(
              request.name,
            ),
          ),
          false,
          "No proxy or login-item operation is part of this acceptance.",
        );
      }
    } catch (error) {
      failure = error;
      record.failureGeometry = await run(`(()=>{
        const describe=node=>{if(!node)return null;const r=node.getBoundingClientRect(),style=getComputedStyle(node);return {tag:node.tagName,role:node.getAttribute('role'),label:node.getAttribute('aria-label'),text:node.textContent?.trim().slice(0,180),active:node===document.activeElement,scrollTop:node.scrollTop,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,position:style.position,zoom:style.zoom,transform:style.transform,inlineStyle:node.getAttribute('style')}};
        const target=document.querySelector('[data-settings-preview-control="target"]');const ancestors=[];for(let node=target?.parentElement;node&&ancestors.length<6;node=node.parentElement)ancestors.push(describe(node));
        return {url:location.pathname,width:innerWidth,height:innerHeight,bodyZoom:getComputedStyle(document.body).zoom,focus:describe(document.activeElement),target:describe(target),ancestors,menus:Array.from(document.querySelectorAll('[role=menu]')).map(describe)};
      })()`).catch((probeError) => ({ error: probeError.message }));
      record.failure = {
        message: error.message,
        stack: error.stack,
        phase: record.uiPhase,
      };
      saveRecord();
      await snapshot("settings-preview-failed").catch(() => {});
    } finally {
      restoring = true;
      try {
        await debuggerApi.sendCommand("Emulation.setTouchEmulationEnabled", {
          enabled: false,
        });
        win.setContentSize(...originalSize);
        await connect();
        if (record.upload && !record.uploadRemoved) {
          if ((await query("library.info")).path !== ownedPath)
            await transition("library.switchTo", {
              source: (await location(ownedPath, "open")).handle,
            });
          await removeUpload();
        }
        if ((await query("library.info")).path !== original.path)
          await transition("library.switchTo", {
            source: (await location(original.path, "open")).handle,
          });
        await run(
          `(()=>{localStorage.clear();for(const [key,value] of Object.entries(${JSON.stringify(originalStorage)}))localStorage.setItem(key,value)})()`,
        );
        await win.loadURL(origin);
        await waitFor("document.querySelector('[data-slot=window]')");
        assert.deepEqual(
          await localState(),
          originalStorage,
          "Restore the complete isolated visiting-device storage exactly.",
        );
        const current = await query("library.info");
        assert.deepEqual(current, original);
        assert.equal(json(join(current.path, "metadata.json")).id, originalId);
        assert.deepEqual(await query("settings.getPrefs"), originalPrefs);
        if (pointer) assert.equal(json(pointer).path, original.path);
        record.restored = true;
        saveRecord();
        assert.equal(dirname(ownedPath), parent);
        assert.match(
          basename(ownedPath),
          /^Circe settings preview \d+-\d+\.pond$/,
        );
        assert.notEqual(realpathSync(original.path), resolve(ownedPath));
        if (existsSync(ownedPath)) {
          const stat = lstatSync(ownedPath);
          assert.ok(record.ownedIdentity);
          assert.equal(stat.isDirectory() && !stat.isSymbolicLink(), true);
          assert.equal(stat.dev, record.ownedIdentity.dev);
          assert.equal(stat.ino, record.ownedIdentity.ino);
          assert.equal(
            json(join(ownedPath, "metadata.json")).id,
            record.ownedId,
          );
          await query("library.recent.remove", { path: ownedPath });
          rmSync(ownedPath, { recursive: true });
        }
        record.cleaned = !existsSync(ownedPath);
        await snapshot("settings-preview-original-restored");
      } catch (error) {
        record.restoreError = error.message;
        failure = failure
          ? new AggregateError(
              [failure, error],
              "Settings/preview recovery needs attention.",
            )
          : error;
      } finally {
        saveRecord();
        debuggerApi.removeListener("message", observe);
        if (debuggerApi.isAttached()) debuggerApi.detach();
      }
    }
    assert.equal(record.restored && record.cleaned, true);
    if (failure) throw failure;
    console.log(
      menuProbeOnly
        ? "WEB_SETTINGS_MENU_PROBE_COMPLETE"
        : recoveryOnly
          ? "WEB_SETTINGS_PREVIEW_RESTORED"
          : "WEB_SETTINGS_PREVIEW_PASSED",
      JSON.stringify({
        checks: record.checks,
        restored: record.restored,
        cleaned: record.cleaned,
        record: recordPath,
      }),
    );
  };
