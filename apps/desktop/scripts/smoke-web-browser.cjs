const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const {
  mkdtempSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");

const origin = process.env.CIRCE_WEB_ORIGIN ?? "http://127.0.0.1:4789";
const sandbox = resolve(
  process.env.POND_SANDBOX ?? "../../.artifacts/iris-web-sandbox",
);
const evidence = resolve("../../.artifacts/web-verification");
const profile = mkdtempSync(join(tmpdir(), "iris-browser-smoke-"));
mkdirSync(evidence, { recursive: true, mode: 0o700 });
chmodSync(evidence, 0o700);
app.setPath("userData", profile);
app.commandLine.appendSwitch("use-mock-keychain");
process.once("exit", () => {
  try {
    rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch (error) {
    console.error("WEB_BROWSER_CLEANUP_FAILED", error.message);
    process.exit(1);
  }
});
const timer = setTimeout(
  () => {
    console.error("WEB_BROWSER_FAILED: timed out");
    app.exit(1);
  },
  process.argv.includes("--import-formats")
    ? 360000
    : process.argv.includes("--viewers") ||
        process.argv.includes("--identity") ||
        process.argv.includes("--file-actions") ||
        process.argv.includes("--previews") ||
        process.argv.includes("--replay") ||
        process.argv.includes("--interactions") ||
        process.argv.includes("--workflow") ||
        process.argv.includes("--upgrade-220") ||
        process.argv.includes("--pairing") ||
        process.argv.includes("--eagle") ||
        process.argv.includes("--pwa-shell") ||
        process.argv.includes("--pwa-shell-restore") ||
        process.argv.includes("--fonts") ||
        process.argv.includes("--transfers") ||
        process.argv.includes("--transfers-restore") ||
        process.argv.includes("--settings-preview") ||
        process.argv.includes("--settings-preview-restore") ||
        process.argv.includes("--library-copy-storage") ||
        process.argv.includes("--library-copy-storage-restore") ||
        process.argv.includes("--host-maintenance") ||
        process.argv.includes("--library-admin") ||
        process.argv.includes("--library-admin-restore")
      ? 300000
      : 120000,
);

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // The visible test window must keep rendering after a host relaunch foregrounds its native window.
        backgroundThrottling: false,
      },
    });
    win.webContents.on("console-message", (event) => {
      if (event.level === "error")
        console.error("BROWSER_ERROR", event.message);
    });
    const run = (code) => win.webContents.executeJavaScript(code, true);
    const boundedOperation = (operation, label, timeoutMs = 5000) =>
      new Promise((resolveCapture, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Browser operation timed out: ${label}`)),
          timeoutMs,
        );
        Promise.resolve()
          .then(operation)
          .then(
            (value) => {
              clearTimeout(timer);
              resolveCapture(value);
            },
            (error) => {
              clearTimeout(timer);
              reject(error);
            },
          );
      });
    const snapshot = async (name) => {
      await boundedOperation(
        () =>
          run(
            "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
          ),
        `${name} animation frames`,
      );
      const page = await boundedOperation(
        () => win.webContents.capturePage(),
        `${name} pixels`,
      );
      const text = await boundedOperation(
        () => run("document.body.innerText"),
        `${name} text`,
      );
      const screenshotPath = join(evidence, `${name}.png`);
      const textPath = join(evidence, `${name}.txt`);
      writeFileSync(screenshotPath, page.toPNG(), { mode: 0o600 });
      writeFileSync(textPath, text, { mode: 0o600 });
      chmodSync(screenshotPath, 0o600);
      chmodSync(textPath, 0o600);
      return text;
    };
    const waitFor = (expression, timeoutMs = 20000) =>
      boundedOperation(
        () =>
          run(`new Promise((resolve, reject) => {
    const started = Date.now(); const check = () => {
      if (${expression}) resolve(true);
      else if (Date.now() - started > ${timeoutMs}) reject(new Error("Browser condition timed out: " + ${JSON.stringify(expression)}));
      else setTimeout(check, 100);
    }; check();
  })`),
        `condition: ${expression}`,
        timeoutMs + 5000,
      );
    const startupToast = `Array.from(document.querySelectorAll('[data-slot="toasts"] button')).find(button => button.textContent?.trim() === 'Not Now')`;
    const startupPrompt = `Boolean(${startupToast}) || Array.from(document.querySelectorAll('[role="dialog"]')).some(dialog => {
      const title = dialog.querySelector('h2, [role="heading"]')?.textContent?.trim() ?? '';
      return /^(Meet Your Fish|What's New)/.test(title) || Array.from(dialog.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Not Now');
    })`;
    const dismissStartupPrompt = async () => {
      if (!(await run(startupPrompt))) return;
      await snapshot("startup-prompt");
      if (await run(`Boolean(${startupToast})`)) {
        const point = await run(
          `(() => { const button=${startupToast}; const rect=button.getBoundingClientRect(); const x=Math.round(rect.x+rect.width/2), y=Math.round(rect.y+rect.height/2); if(!button.contains(document.elementFromPoint(x,y))) throw new Error('Startup ask is covered'); return {x,y}; })()`,
        );
        win.webContents.sendInputEvent({ type: "mouseMove", ...point });
        win.webContents.sendInputEvent({
          type: "mouseDown",
          button: "left",
          clickCount: 1,
          ...point,
        });
        win.webContents.sendInputEvent({
          type: "mouseUp",
          button: "left",
          clickCount: 1,
          ...point,
        });
      } else {
        win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      }
      await waitFor(`!(${startupPrompt})`);
    };
    const click = async (selector, clickCount = 1) => {
      if (
        selector === 'button[aria-label="Choose key file"]' &&
        !(await run('Boolean(document.querySelector("#host-key"))'))
      )
        await click("#connection-method");
      app.focus({ steal: true });
      win.focus();
      // Focus before a prompt snapshot: an occluded renderer can suspend animation frames.
      win.webContents.focus();
      await waitFor("document.hasFocus()");
      await dismissStartupPrompt();
      const point = await boundedOperation(
        () =>
          run(`new Promise((resolve,reject) => {
        let previous = ''; let stable = 0; const started = Date.now();
        const check = () => {
          const target = document.querySelector(${JSON.stringify(selector)});
          if (target) {
            target.scrollIntoView({block:'nearest',inline:'nearest'});
            const rect = target.getBoundingClientRect();
            const point = {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};
            const hit = document.elementFromPoint(point.x,point.y);
            const current = JSON.stringify(point);
            stable = current === previous ? stable+1 : 0; previous = current;
            if (rect.width && rect.height && hit && target.contains(hit) && stable >= 3) {resolve(point);return;}
          }
          if (Date.now()-started>10000) {reject(new Error('Control is not clickable: ' + ${JSON.stringify(selector)}));return;}
          requestAnimationFrame(check);
        }; check();
      })`),
        `pointer stability: ${selector}`,
        12000,
      );
      win.webContents.sendInputEvent({ type: "mouseMove", ...point });
      win.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount,
        ...point,
      });
      win.webContents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount,
        ...point,
      });
    };
    const titles = new Map();
    const openSave = async (id) => {
      const selector = `[data-save-id="${id}"] [role="option"]`;
      if (
        !(await run(
          `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
        ))
      ) {
        if (
          await run(
            "Boolean(document.querySelector('[aria-label=\"Clear Search\"]'))",
          )
        )
          await click('[aria-label="Clear Search"]');
        const title = titles.get(id);
        assert.ok(title, "The fixture must have a searchable title.");
        await run("document.querySelector('[data-library-search]').focus()");
        await win.webContents.insertText(title);
        await waitFor(`document.querySelector(${JSON.stringify(selector)})`);
      }
      await click(selector);
      await click(selector, 2);
    };
    const closeFolderMenu = async () => {
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await waitFor("!document.querySelector('[data-type=\"menu\"]')");
    };
    try {
      await win.loadURL(origin);
      await waitFor('document.querySelector("[data-browser-connection]")');
      await snapshot("login-code");
      await click("#connection-method");
      await waitFor('document.querySelector("#host-key-file")');
      await waitFor(
        `['#host-key','button[aria-label="Choose key file"]'].every(selector => { const el=document.querySelector(selector); if(!el)return false; const r=el.getBoundingClientRect(); return r.width>0 && r.height>0 && el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })`,
      );
      assert.equal(
        await run(
          `['#host-key','button[aria-label="Choose key file"]'].every(selector => { const el=document.querySelector(selector), r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })`,
        ),
        true,
        "Sign-in controls must receive pointer input",
      );
      await snapshot("login");
      const key = readFileSync(join(sandbox, "web-access-key"), "utf8").trim();
      const login = await fetch(`${origin}/web/session`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      assert.equal(login.status, 200);
      let { libraryId } = await login.json();
      let cookieHeader = login.headers.get("set-cookie").split(";")[0];
      const cookie = cookieHeader.split("=")[1];
      const refreshSession = async ({ allowLibraryChange = false } = {}) => {
        const cookies = await win.webContents.session.cookies.get({
          url: origin,
          name: "iris_session",
        });
        assert.equal(
          cookies.length,
          1,
          "The browser must have one host session.",
        );
        const nextCookie = `iris_session=${cookies[0].value}`;
        const response = await fetch(`${origin}/web/session`, {
          headers: { cookie: nextCookie },
          signal: AbortSignal.timeout(15000),
        });
        assert.equal(
          response.status,
          200,
          "The UI login must create a valid session.",
        );
        const next = await response.json();
        if (!allowLibraryChange)
          assert.equal(
            next.libraryId,
            libraryId,
            "Renaming must preserve the Library identity.",
          );
        cookieHeader = nextCookie;
        libraryId = next.libraryId;
        return { libraryId };
      };
      const query = async (name, params = {}) => {
        const route = name === "library.rename" ? "library" : "query";
        const response = await fetch(`${origin}/web/${route}`, {
          method: "POST",
          headers: {
            cookie: cookieHeader,
            origin,
            "content-type": "application/json",
            "x-iris-library": libraryId,
          },
          body: JSON.stringify({ name, params }),
          signal: AbortSignal.timeout(30000),
        });
        assert.equal(response.status, 200);
        return response.json();
      };
      const fixtureSaves = async () => {
        const found = await query("saves.searchFts", {
          q: "fixture",
          limit: 1000,
          deletedOnly: false,
          mode: "all",
        });
        return query("saves.getMany", { ids: found.ids });
      };
      const libraryAdmin =
        process.argv.includes("--library-admin") ||
        process.argv.includes("--library-admin-restore");
      const fileActions = process.argv.includes("--file-actions");
      const hostMaintenance = process.argv.includes("--host-maintenance");
      const previews = process.argv.includes("--previews");
      const replay = process.argv.includes("--replay");
      const interactions = process.argv.includes("--interactions");
      const imageNavigation = process.argv.includes("--image-navigation");
      const eagle = process.argv.includes("--eagle");
      const fonts = process.argv.includes("--fonts");
      const importFormats = process.argv.includes("--import-formats");
      const pwaShell =
        process.argv.includes("--pwa-shell") ||
        process.argv.includes("--pwa-shell-restore");
      const transfers =
        process.argv.includes("--transfers") ||
        process.argv.includes("--transfers-restore");
      const settingsPreview =
        process.argv.includes("--settings-preview") ||
        process.argv.includes("--settings-preview-restore");
      const libraryCopyStorage =
        process.argv.includes("--library-copy-storage") ||
        process.argv.includes("--library-copy-storage-restore");
      const focusProbe = process.argv.includes("--focus-probe");
      const standalone =
        process.argv.includes("--pairing") ||
        process.argv.includes("--upgrade-220") ||
        process.argv.includes("--workflow") ||
        process.argv.includes("--release-audit") ||
        process.argv.includes("--identity") ||
        libraryAdmin ||
        fileActions ||
        hostMaintenance ||
        previews ||
        replay ||
        interactions ||
        imageNavigation ||
        eagle ||
        fonts ||
        importFormats ||
        settingsPreview ||
        transfers ||
        pwaShell ||
        libraryCopyStorage ||
        focusProbe;
      const page = { rows: standalone ? [] : await fixtureSaves() };
      for (const save of page.rows) titles.set(save.id, save.title);
      const image = page.rows.find(
        (save) => save.sourceId === "900000000000000002",
      );
      const video = page.rows.find(
        (save) => save.sourceId === "900000000000000003",
      );
      if (!standalone)
        assert.ok(
          image && video,
          "Run smoke-web.mjs first to ingest media fixtures",
        );
      await win.webContents.session.cookies.set({
        url: origin,
        name: "iris_session",
        value: cookie,
        httpOnly: true,
        sameSite: "strict",
      });
      await win.loadURL(origin);
      await waitFor(
        standalone
          ? 'document.querySelector("[data-slot=window], [data-library-search]") || Array.from(document.querySelectorAll("button")).some(node => node.textContent.trim() === "Exit settings")'
          : 'document.querySelector("#fixture-kind") && document.querySelector("[data-library-search]")',
      );
      if (focusProbe) {
        const recordPath = join(evidence, `focus-probe-${Date.now()}.json`);
        const original = await query("library.info");
        const record = {
          mainPid: process.pid,
          rendererPid: win.webContents.getOSProcessId(),

          original,
          steps: [],
          completed: false,
        };
        const save = () =>
          writeFileSync(recordPath, JSON.stringify(record, null, 2), {
            mode: 0o600,
          });
        const step = async (name, operation) => {
          record.phase = name;
          save();
          const started = Date.now();
          const result = await operation();
          record.steps.push({ name, elapsedMs: Date.now() - started });
          save();
          return result;
        };
        try {
          record.before = await step("initial browser state", () =>
            boundedOperation(
              () =>
                run(
                  "({hasFocus:document.hasFocus(),hidden:document.hidden,visibility:document.visibilityState,active:document.activeElement?.tagName,dialogs:Array.from(document.querySelectorAll('[role=dialog]')).map(node=>node.querySelector('h2,[role=heading]')?.textContent?.trim())})",
                ),
              "focus probe state",
            ),
          );
          record.windowBefore = {
            focused: win.isFocused(),
            visible: win.isVisible(),
            minimized: win.isMinimized(),
          };
          app.focus({ steal: true });
          win.focus();
          win.webContents.focus();
          await step("document receives focus", () =>
            waitFor("document.hasFocus()"),
          );
          record.frames = await step("animation frames after focus", () =>
            boundedOperation(
              () =>
                run(
                  "new Promise(resolve=>{const first=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({first,last:performance.now(),hasFocus:document.hasFocus(),visibility:document.visibilityState})))})",
                ),
              "focus probe animation frames",
            ),
          );
          await step("first real sidebar click", () =>
            click('[aria-label="Toggle Sidebar"]'),
          );
          await step("second real sidebar click", () =>
            click('[aria-label="Toggle Sidebar"]'),
          );
          await step("actual New menu click", () =>
            click('[aria-label="New"]'),
          );
          await step("New menu visible", () =>
            waitFor(`document.querySelector('[aria-label="Search Actions"]')`),
          );
          for (const type of ["keyDown", "keyUp"])
            win.webContents.sendInputEvent({ type, keyCode: "Escape" });
          await step("actual Escape closes menu", () =>
            waitFor(`!document.querySelector('[aria-label="Search Actions"]')`),
          );
          await step("rendered browser snapshot", () =>
            snapshot("focus-probe"),
          );
          assert.deepEqual(await query("library.info"), original);
          record.completed = true;
        } catch (error) {
          record.failure = { message: error.message, stack: error.stack };
          throw error;
        } finally {
          save();
        }
        console.log(
          "WEB_FOCUS_PROBE_PASSED",
          JSON.stringify({ record: recordPath, steps: record.steps }),
        );
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (importFormats) {
        const {
          verifyBrowserImportFormats,
        } = require("./web-import-format-cases.cjs");
        await verifyBrowserImportFormats({
          win,
          run,
          waitFor,
          snapshot,
          query,
          origin,
          evidence,
          sandbox,
          refreshSession,
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (fonts) {
        const { verifyBrowserFonts } = require("./web-font-cases.cjs");
        await verifyBrowserFonts({
          win,
          run,
          waitFor,
          snapshot,
          query,
          origin,
          evidence,
          sandbox,
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (pwaShell) {
        const { verifyBrowserPwaShell } = require("./web-pwa-shell-cases.cjs");
        await verifyBrowserPwaShell({
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
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (transfers) {
        const { verifyBrowserTransfers } = require("./web-transfer-cases.cjs");
        await verifyBrowserTransfers({
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
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (settingsPreview) {
        const {
          verifyBrowserSettingsPreview,
        } = require("./web-settings-preview-cases.cjs");
        await verifyBrowserSettingsPreview({
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
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (eagle) {
        const { verifyBrowserEagle } = require("./web-eagle-cases.cjs");
        await verifyBrowserEagle({
          win,
          run,
          click,
          waitFor,
          snapshot,
          query,
          origin,
          evidence,
          sandbox,
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (imageNavigation) {
        const {
          verifyBrowserImageNavigation,
        } = require("./web-image-navigation-cases.cjs");
        await verifyBrowserImageNavigation({
          win,
          run,
          click,
          waitFor,
          query,
          origin,
          evidence,
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (interactions) {
        const {
          verifyBrowserInteractions,
        } = require("./web-browser-interactions-cases.cjs");
        await verifyBrowserInteractions({
          win,
          run,
          click,
          waitFor,
          snapshot,
          query,
          origin,
          evidence,
          sandbox,
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (libraryCopyStorage) {
        const {
          verifyBrowserLibraryCopyStorage,
        } = require("./web-library-copy-storage-cases.cjs");
        await verifyBrowserLibraryCopyStorage({
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
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (replay) {
        const { verifyBrowserReplay } = require("./web-replay-cases.cjs");
        await verifyBrowserReplay({
          win,
          run,
          click,
          waitFor,
          snapshot,
          query,
          origin,
          evidence,
          sandbox,
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (previews) {
        const { verifyBrowserPreviews } = require("./web-preview-cases.cjs");
        await verifyBrowserPreviews({
          win,
          run,
          click,
          waitFor,
          snapshot,
          query,
          origin,
          evidence,
          sandbox,
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (hostMaintenance) {
        const {
          verifyBrowserHostMaintenance,
        } = require("./web-host-maintenance-cases.cjs");
        await verifyBrowserHostMaintenance({
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
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (fileActions) {
        const {
          verifyBrowserFileActions,
        } = require("./web-file-action-cases.cjs");
        await verifyBrowserFileActions({
          win,
          run,
          click,
          waitFor,
          snapshot,
          query,
          origin,
          evidence,
          sandbox,
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (libraryAdmin) {
        const { verifyBrowserLibraries } = require("./web-library-cases.cjs");
        await verifyBrowserLibraries({
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
          restoreOnly: process.argv.includes("--library-admin-restore"),
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (process.argv.includes("--identity")) {
        const { verifyBrowserIdentity } = require("./web-identity-cases.cjs");
        await verifyBrowserIdentity({
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
          settingsOnly: process.argv.includes("--identity-settings"),
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (process.argv.includes("--workflow")) {
        const { verifyBrowserWorkflow } = require("./web-workflow-cases.cjs");
        await verifyBrowserWorkflow({
          win,
          run,
          click,
          waitFor,
          snapshot,
          query,
          origin,
          evidence,
          sandbox,
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (process.argv.includes("--pairing")) {
        const { verifyBrowserPairing } = require("./web-pairing-cases.cjs");
        await verifyBrowserPairing({
          win,
          run,
          click,
          waitFor,
          snapshot,
          query,
          refreshSession,
          origin,
          evidence,
          sandbox,
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (process.argv.includes("--upgrade-220")) {
        const context = {
          win,
          run,
          click,
          waitFor,
          snapshot,
          query,
          origin,
          evidence,
          sandbox,
        };
        const {
          verifyUpgradeSources,
        } = require("./web-upgrade-sources-cases.cjs");
        const { verifyUpgradeFish } = require("./web-upgrade-fish-cases.cjs");
        const { verifyUpgradeChat } = require("./web-upgrade-chat-cases.cjs");
        const selected = process.env.CIRCE_UPGRADE_CASE;
        assert.ok(!selected || ["sources", "fish", "chat"].includes(selected));
        if (!selected || selected === "sources")
          await verifyUpgradeSources(context);
        if (!selected || selected === "fish") await verifyUpgradeFish(context);
        if (!selected || selected === "chat") await verifyUpgradeChat(context);
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (process.argv.includes("--release-audit")) {
        const { verifyBrowserRelease } = require("./web-release-cases.cjs");
        await verifyBrowserRelease({
          win,
          run,
          click,
          waitFor,
          snapshot,
          query,
          origin,
          evidence,
          sandbox,
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (process.argv.includes("--extension-setup")) {
        const { verifyExtensionSetup } = require("./web-extension-cases.cjs");
        await verifyExtensionSetup({
          win,
          origin,
          run,
          click,
          waitFor,
          snapshot,
          query,
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (process.argv.includes("--editing")) {
        const { verifyBrowserEditing } = require("./web-editing-cases.cjs");
        await verifyBrowserEditing({
          win,
          run,
          click,
          waitFor,
          snapshot,
          query,
          origin,
          evidence,
          sandbox,
          afterRestart: process.argv.includes("--after-restart"),
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      if (process.argv.includes("--viewers")) {
        const { verifyBrowserViewers } = require("./web-viewer-cases.cjs");
        const registered = JSON.parse(
          readFileSync(join(sandbox, "viewer-fixtures.json"), "utf8"),
        );
        const only = process.argv
          .find((value) => value.startsWith("--viewer="))
          ?.slice(9);
        const fixtures = only
          ? registered.filter((fixture) => fixture.kind === only)
          : registered;
        assert.ok(fixtures.length, "Choose a registered viewer fixture.");
        await verifyBrowserViewers({
          win,
          run,
          waitFor,
          click,
          snapshot,
          fixtures,
          origin,
          evidence,
        });
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      const searchTerm = `irissmoke${Date.now().toString(36)}`;
      const searchTitle = `${image.title} ${searchTerm}`;
      const setSearchTitle = async (before, title) => {
        const response = await fetch(`${origin}/web/transactions`, {
          method: "POST",
          headers: {
            cookie: cookieHeader,
            origin,
            "content-type": "application/json",
            "x-iris-library": libraryId,
          },
          body: JSON.stringify({
            transactions: [
              {
                kind: "update",
                model: "save",
                id: image.id,
                before: { title: before },
                patch: { title },
              },
            ],
          }),
        });
        assert.equal(
          response.status,
          200,
          "Update only this fixture's unchanged title.",
        );
      };
      // Enrichment can legitimately make the video's caption match ordinary image keywords.
      await setSearchTitle(image.title, searchTitle);
      try {
        await run("document.querySelector('[data-library-search]').focus()");
        await win.webContents.insertText(searchTerm);
        await waitFor(
          `document.querySelector('[data-save-id="${image.id}"]') && !document.querySelector('[data-save-id="${video.id}"]')`,
        );
        await snapshot("search-results");
      } finally {
        await setSearchTitle(searchTitle, image.title);
      }
      await click('[aria-label="Clear Search"]');
      await waitFor('document.querySelectorAll("[data-save-id]").length >= 3');
      if (process.argv.includes("--disconnect")) {
        console.log("WEB_BROWSER_READY_FOR_DISCONNECT");
        await waitFor('document.body.innerText.includes("Host disconnected")');
        await snapshot("host-disconnected");
        console.log("WEB_DISCONNECTION_PASSED");
        clearTimeout(timer);
        app.exit(0);
        return;
      }
      const initial = await snapshot("desktop-library");
      assert.ok(
        !initial.includes("This action needs the Circé desktop host"),
        "Startup must not invoke unsupported operations",
      );
      await run(
        `document.querySelector('#fixture-kind').value='quote'; Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Enqueue fixture')).click()`,
      );
      await waitFor(
        'document.body.innerText.includes("Save enqueued") || document.body.innerText.includes("Fixture already")',
      );
      await snapshot("desktop-enqueued");
      const all = { rows: await fixtureSaves() };
      for (const save of all.rows) titles.set(save.id, save.title);
      const quote = all.rows.find(
        (save) => save.sourceId === "900000000000000001",
      );
      assert.ok(quote, "The quote fixture must be in this Library.");
      await openSave(quote.id);
      await waitFor('document.querySelector("[data-save-details]")');
      await click('[aria-label="Back"]');
      if (
        await run(
          `Boolean(document.querySelector('[aria-label="Clear Search"]'))`,
        )
      )
        await click('[aria-label="Clear Search"]');
      const library = await query("library.info");
      assert.ok(library.path.startsWith(sandbox));
      for (const sourceId of [
        "900000000000000001",
        "900000000000000002",
        "900000000000000003",
      ]) {
        const save = all.rows.find((row) => row.sourceId === sourceId);
        assert.ok(save);
        const { rawJson } = await query("saves.rawJson", { id: save.id });
        const stored = JSON.parse(
          readFileSync(
            join(library.path, "items", `${save.id}.info`, "source.json"),
            "utf8",
          ),
        );
        assert.equal(rawJson.capture.id, sourceId);
        assert.deepEqual(stored.capture, rawJson.capture);
        const light = save.files.find(
          (file) => file.kind === "tweet_screenshot_light",
        );
        const dark = save.files.find(
          (file) => file.kind === "tweet_screenshot_dark",
        );
        assert.ok(light && dark && light.sha256 !== dark.sha256);
        if (sourceId === "900000000000000001") {
          assert.equal(stored.capture.quoted.id, "900000000000000004");
          assert.equal(stored.capture.author.handle, "iris_fixture");
          assert.equal(stored.capture.quoted.author.handle, "quoted_fixture");
        }
      }

      await click('[aria-label="New Folder"]');
      await waitFor("document.querySelector('[aria-label=\"Folder name\"]')");
      const folderName = `Browser workflow ${Date.now().toString(36)}`;
      await run(
        `(() => { const input=document.querySelector('[aria-label="Folder name"]'); input.value=${JSON.stringify(folderName)}; input.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true })); })()`,
      );
      await waitFor(
        `document.body.innerText.includes(${JSON.stringify(folderName)}) && !document.querySelector('[aria-label="Folder name"]')`,
      );
      const folder = (await query("folders.list")).find(
        (row) => row.name === folderName,
      );
      assert.ok(folder);
      await snapshot("folder-created");
      await openSave(image.id);
      await waitFor(
        `Array.from(document.querySelectorAll('[data-save-details] img')).some(img => new URL(img.src).pathname === '/web/media/${image.id}/media-1.png' && img.complete && img.naturalWidth > 0)`,
      );
      await snapshot("image-viewer");
      if (
        !(await run(
          "Boolean(document.querySelector('[aria-label=\"Add Folder\"]'))",
        ))
      )
        await click('[aria-label="Toggle Details"]');
      await waitFor("document.querySelector('[aria-label=\"Add Folder\"]')");
      await click('[aria-label="Add Folder"]');
      await waitFor(
        `document.querySelector('[role="menuitemcheckbox"]:has([title="${folderName}"])')`,
      );
      await click(`[role="menuitemcheckbox"]:has([title="${folderName}"])`);
      await closeFolderMenu();
      await waitFor(
        `document.querySelector('[aria-label="Remove folder ${folderName}"]')`,
      );
      await snapshot("folder-assigned");
      await click(`[aria-label="Remove folder ${folderName}"]`);
      await waitFor(
        `!document.querySelector('[aria-label="Remove folder ${folderName}"]')`,
      );
      assert.ok(
        !(await query("folders.memberships")).some(
          (row) => row.saveId === image.id && row.folderId === folder.id,
        ),
      );
      await click('[aria-label="Add Folder"]');
      await waitFor(
        `document.querySelector('[role="menuitemcheckbox"]:has([title="${folderName}"])')`,
      );
      await click(`[role="menuitemcheckbox"]:has([title="${folderName}"])`);
      await closeFolderMenu();
      await waitFor(
        `document.querySelector('[aria-label="Remove folder ${folderName}"]')`,
      );
      writeFileSync(
        join(sandbox, "ui-verification-state.json"),
        JSON.stringify({ folderId: folder.id, saveId: image.id }),
      );
      await click('[aria-label="Back"]');
      await waitFor(
        `location.pathname === '/' && document.querySelector('[data-library-search]')`,
      );
      await click(`[data-folder-sortable="${folder.id}"] [role="treeitem"]`);
      await waitFor(
        `new URLSearchParams(location.search).get('folder') === '${folder.id}' && document.querySelector('[data-save-id="${image.id}"]')`,
      );
      const folderReloaded = new Promise((resolve) =>
        win.webContents.once("did-finish-load", resolve),
      );
      win.reload();
      await folderReloaded;
      await waitFor(
        `new URLSearchParams(location.search).get('folder') === '${folder.id}' && document.querySelector('[aria-label="Breadcrumb"]')?.innerText.includes(${JSON.stringify(folderName)}) && document.querySelector('[data-save-id="${image.id}"]')`,
      );
      await snapshot("folder-reloaded");
      await click('[aria-label="Back"]');
      await waitFor(
        `!location.search.includes('folder=') && document.querySelector('[data-library-search]')`,
      );
      await openSave(video.id);
      await waitFor(
        'Array.from(document.querySelectorAll("video")).some(video => video.readyState >= 1 && video.duration >= 4)',
      );
      await run(
        `(() => { const video=Array.from(document.querySelectorAll('video')).find(video => video.readyState>=1); video.muted=true; video.currentTime=2; return video.play(); })()`,
      );
      await waitFor(
        'Array.from(document.querySelectorAll("video")).some(video => video.currentTime >= 2 && !video.paused)',
      );
      await run(
        `new Promise(resolve => { const video=Array.from(document.querySelectorAll('video')).find(video => video.readyState>=2); if (!video) throw new Error('No decoded video'); video.requestVideoFrameCallback(() => resolve()); })`,
      );
      assert.equal(
        await run(
          `Array.from(document.querySelectorAll('video')).some(video => video.videoWidth === 640 && video.currentSrc.includes('${video.id}/video'))`,
        ),
        true,
      );
      writeFileSync(
        join(evidence, "video-state.json"),
        JSON.stringify(
          await run(
            `Array.from(document.querySelectorAll('video')).map(video => ({ source:video.currentSrc, time:video.currentTime, width:video.videoWidth, height:video.videoHeight, paused:video.paused, frames:video.getVideoPlaybackQuality().totalVideoFrames }))`,
          ),
        ),
      );
      await snapshot("video-seeking");
      assert.equal(
        new URL(win.webContents.getURL()).pathname,
        `/save/${video.id}`,
      );
      const reloaded = new Promise((resolve) =>
        win.webContents.once("did-finish-load", resolve),
      );
      win.reload();
      await reloaded;
      await waitFor(
        'Array.from(document.querySelectorAll("video")).some(video => video.readyState >= 1)',
      );
      await snapshot("reload-viewer");
      win.setSize(390, 844);
      await waitFor("window.innerWidth === 390");
      if (
        await run(
          `document.querySelector('[data-slot="right"]').hasAttribute("data-open")`,
        )
      )
        await click('[aria-label="Toggle Details"]');
      if (
        await run(
          `document.querySelector('[data-slot="window"]').hasAttribute("data-left-open")`,
        )
      )
        await click('[aria-label="Toggle Sidebar"]');
      await waitFor(
        `!document.querySelector('[data-slot="left"]').hasAttribute("data-open") && !document.querySelector('[data-slot="right"]').hasAttribute("data-open")`,
      );
      await snapshot("mobile-viewer");
      // A separate mobile page starts with the sidebar closed and the shared Library.
      await run(
        `for (const key of Object.keys(localStorage)) if (key.startsWith('pond:lastPath:')) localStorage.removeItem(key)`,
      );
      await win.loadURL(origin);
      await waitFor(
        'document.body.innerText.includes("Search your library") && document.querySelector("#fixture-kind")',
      );
      await waitFor(
        '!document.querySelector(\'[data-slot="left"]\').hasAttribute("data-open")',
      );
      await waitFor('document.querySelectorAll("[data-save-id]").length >= 3');
      await snapshot("mobile-library");
      assert.ok(
        !(await run("document.body.innerText")).includes(
          "This action needs the Circé desktop host",
        ),
      );
      console.log(
        "WEB_BROWSER_PASSED",
        JSON.stringify({
          desktop: [1280, 900],
          mobile: [390, 844],
          folderId: folder.id,
          image: true,
          videoSeeking: true,
          reload: true,
          folderReload: true,
          evidence,
        }),
      );
      clearTimeout(timer);
      app.exit(0);
    } catch (error) {
      await snapshot("failed");
      console.error("WEB_BROWSER_FAILED", error.message);
      clearTimeout(timer);
      app.exit(1);
    }
  })
  .catch((error) => {
    console.error("WEB_BROWSER_FAILED", error.message);
    clearTimeout(timer);
    app.exit(1);
  });
