const assert = require("node:assert/strict");
const { writeFileSync } = require("node:fs");
const { join, resolve, sep } = require("node:path");
const { setTimeout: pause } = require("node:timers/promises");
const { version } = require("../package.json");

/** Real shared UI, device-local preferences and Chromium pointer input. */
exports.verifyBrowserRelease = async function verifyBrowserRelease({
  win,
  run,
  click,
  waitFor,
  snapshot,
  query,
  origin,
  evidence,
  sandbox,
}) {
  assert.match(
    resolve(sandbox).split(sep).join("/"),
    /\/(?:added-commits-\d{8}\/sandbox(?:-[a-z0-9-]+)?|pond-220-\d{8}\/upgrade-220|iris-web-ci-[a-z0-9-]+)$/i,
  );
  assert.ok(
    resolve((await query("library.info")).path).startsWith(
      resolve(sandbox) + sep,
    ),
  );
  const debuggerApi = win.webContents.debugger;
  debuggerApi.attach("1.3");
  const platform = process.env.CIRCE_RELEASE_PLATFORM ?? "Win32";
  const userAgent = await run("navigator.userAgent");
  await debuggerApi.sendCommand("Emulation.setUserAgentOverride", {
    userAgent,
    platform,
  });
  await win.loadURL(`${origin}/settings/appearance`);
  const master = '[role="switch"][aria-label="All Sounds"]';
  await waitFor(`document.querySelector(${JSON.stringify(master)})`);
  const originalDevice = await run(
    "window.pond.query('settings.getPrefs', {})",
  );
  const originalHost = await query("settings.getPrefs");
  const results = { platform, checks: {} };
  let importedId;
  const checked = (selector) =>
    run(
      `document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-checked')`,
    );
  const reloadSounds = async () => {
    await win.loadURL(`${origin}/settings/appearance`);
    await waitFor(`document.querySelector(${JSON.stringify(master)})`);
  };
  const setSounds = async (enabled) => {
    if ((await checked(master)) !== String(enabled)) await click(master);
    await waitFor(
      `document.querySelector(${JSON.stringify(master)})?.getAttribute('aria-checked') === ${JSON.stringify(String(enabled))}`,
    );
  };
  const sideButton = async (button, buttons) => {
    await debuggerApi.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: 800,
      y: 100,
      button,
      buttons,
      clickCount: 1,
    });
    await debuggerApi.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: 800,
      y: 100,
      button,
      buttons: 0,
      clickCount: 1,
    });
  };
  const nav = async (label, path) => {
    if (
      !(await run(
        "document.querySelector('[data-slot=window]')?.hasAttribute('data-left-open')",
      ))
    )
      await click('[aria-label="Toggle Sidebar"]');
    await waitFor(
      `Array.from(document.querySelectorAll('button, [role="button"], a')).some(node => node.getBoundingClientRect().width > 0 && node.textContent.trim() === ${JSON.stringify(label)})`,
    );
    await run(`(() => {
      document.querySelectorAll('[data-release-control]').forEach(node => node.removeAttribute('data-release-control'));
      const controls = Array.from(document.querySelectorAll('button, [role="button"], a')).filter(node => node.getBoundingClientRect().width > 0);
      const button = controls.find(node => node.textContent.trim() === ${JSON.stringify(label)} || Array.from(node.querySelectorAll('span')).some(span => span.textContent.trim() === ${JSON.stringify(label)}));
      if (!button) throw new Error('Missing Settings navigation: ' + ${JSON.stringify(label)} + ' in ' + JSON.stringify(controls.map(node => node.textContent.trim())));
      button.setAttribute('data-release-control', 'target');
    })()`);
    await click('[data-release-control="target"]');
    await waitFor(`location.pathname === ${JSON.stringify(path)}`);
  };
  try {
    assert.equal(await run("navigator.platform"), platform);
    assert.equal(
      (await run("window.pond.appInfo()")).version,
      `${version}-web`,
    );
    results.checks.version = true;
    await setSounds(false);
    await reloadSounds();
    assert.equal(await checked(master), "false");
    const disabled = '[role="switch"][aria-label="Interface Sounds"]';
    await waitFor(
      `document.querySelector(${JSON.stringify(disabled)})?.hasAttribute('data-disabled')`,
    );
    await run(
      `document.querySelector(${JSON.stringify(disabled)}).scrollIntoView({ block: 'center', inline: 'nearest' })`,
    );
    await waitFor(`(() => {
      const root = document.querySelector(${JSON.stringify(disabled)});
      const rect = root.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      return x > 0 && x < innerWidth && y > 0 && y < innerHeight && root.contains(document.elementFromPoint(x, y));
    })()`);
    const style = () =>
      run(`(() => {
      const root = document.querySelector(${JSON.stringify(disabled)});
      const thumb = root.querySelector('span');
      const css = getComputedStyle(root);
      const rect = root.getBoundingClientRect();
      return { opacity: css.opacity, cursor: css.cursor, background: css.backgroundColor, checked: root.getAttribute('aria-checked'), width: thumb?.getBoundingClientRect().width, x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
    })()`);
    const before = await style();
    assert.ok(
      Number.isFinite(before.width),
      "Measure the rendered switch thumb.",
    );
    assert.equal(before.opacity, "0.5");
    assert.equal(before.cursor, "not-allowed");
    await debuggerApi.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: before.x,
      y: before.y,
    });
    await pause(250);
    assert.equal((await style()).background, before.background);
    await debuggerApi.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: before.x,
      y: before.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await pause(250);
    assert.equal((await style()).width, before.width);
    await debuggerApi.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: before.x,
      y: before.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    assert.equal((await style()).checked, before.checked);
    await pause(250);
    await reloadSounds();
    assert.equal(await checked(master), "false");
    assert.equal(await checked(disabled), before.checked);
    assert.deepEqual(
      (await run("window.pond.query('settings.getPrefs', {})")).feedback.sounds,
      originalDevice.feedback.sounds,
    );
    assert.deepEqual(
      (await query("settings.getPrefs")).feedback.sounds,
      originalHost.feedback.sounds,
    );
    results.checks.disabledSwitch = {
      opacity: before.opacity,
      cursor: before.cursor,
      stableHoverAndPress: true,
      blockedChange: true,
      pointerTargetVisible: true,
    };
    await snapshot(`release-${platform}-disabled-switch`);
    await setSounds(true);
    await reloadSounds();
    assert.equal(await checked(master), "true");
    assert.ok(
      !(await run(
        `document.querySelector(${JSON.stringify(disabled)}).hasAttribute('data-disabled')`,
      )),
    );
    assert.equal(
      (await query("settings.getPrefs")).preferences.soundsEnabled,
      originalHost.preferences.soundsEnabled,
    );
    results.checks.deviceSoundPersistence = true;

    await nav("Preferences", "/settings/general");
    await nav("Appearance", "/settings/appearance");
    await nav("Storage", "/settings/storage");
    const index = await run("history.state.__TSR_index");
    await sideButton("back", 8);
    await waitFor("location.pathname === '/settings/appearance'");
    await pause(350);
    assert.equal(await run("location.pathname"), "/settings/appearance");
    assert.equal(await run("history.state.__TSR_index"), index - 1);
    await sideButton("forward", 16);
    await waitFor("location.pathname === '/settings/storage'");
    await pause(350);
    assert.equal(await run("history.state.__TSR_index"), index);
    results.checks.sideButtons = { oneStepBack: true, oneStepForward: true };
    await snapshot(`release-${platform}-side-buttons`);
    results.checks.nativeEventAdapters = await run(`(() => {
      const swipe = window.pond.onNavigationSwipe(() => {});
      const fullscreen = window.pond.onFullScreenChange(() => {});
      swipe(); fullscreen(); return true;
    })()`);
    assert.equal(results.checks.nativeEventAdapters, true);
    const imported = await run(`(async () => {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0));
      const file = new File([bytes], 'Release origin ' + Date.now() + '.png', { type: 'image/png' });
      const path = window.pond.pathForFile(file);
      return window.pond.query('saves.importFiles', { paths: [path] });
    })()`);
    assert.equal(imported.ok, true);
    assert.equal(imported.ids.length, 1);
    importedId = imported.ids[0];
    assert.equal(
      (await query("saves.get", { id: importedId })).importedFrom,
      "files",
    );
    await win.loadURL(`${origin}/save/${importedId}`);
    await waitFor("document.querySelector('[data-slot=window]')");
    if (
      !(await run(
        "document.querySelector('[data-slot=window]')?.hasAttribute('data-right-open')",
      ))
    )
      await click('[aria-label="Toggle Details"]');
    await waitFor(
      "Array.from(document.querySelectorAll('span')).some(label => label.textContent.trim() === 'Imported From' && Array.from(label.parentElement.querySelectorAll('span')).some(value => value.textContent.trim() === 'Files'))",
    );
    await snapshot(`release-${platform}-imported-from`);
    await win.loadURL(`${origin}/save/${importedId}`);
    await waitFor(
      "Array.from(document.querySelectorAll('span')).some(label => label.textContent.trim() === 'Imported From' && Array.from(label.parentElement.querySelectorAll('span')).some(value => value.textContent.trim() === 'Files'))",
    );
    // An explicit library URL bypasses the saved "continue last page" startup choice.
    await win.loadURL(`${origin}/?q=`);
    if (
      await run(
        "Array.from(document.querySelectorAll('button')).some(node => node.textContent.trim() === 'Exit settings')",
      )
    ) {
      await run(
        "Array.from(document.querySelectorAll('button')).find(node => node.textContent.trim() === 'Exit settings').setAttribute('data-release-exit', 'true')",
      );
      await click('[data-release-exit="true"]');
    }
    await waitFor("document.querySelector('[data-library-search]')");
    await click("[data-library-search]");
    win.webContents.selectAll();
    await win.webContents.insertText("imported:files");
    const filtered = await query("saves.query", {
      deletedOnly: false,
      limit: 1000,
      query: {
        combinator: "and",
        rules: [{ field: "importedFrom", operator: "eq", value: "files" }],
      },
    });
    await waitFor(
      `document.querySelector('[data-save-id="${importedId}"]') && Array.from(document.querySelectorAll('[data-save-id]')).every(node => ${JSON.stringify(filtered.ids)}.includes(node.dataset.saveId))`,
    );
    const visible = await run(
      "Array.from(document.querySelectorAll('[data-save-id]')).map(node => node.dataset.saveId)",
    );
    for (const id of new Set(visible))
      assert.equal((await query("saves.get", { id })).importedFrom, "files");
    results.checks.importedFromUi = {
      detail: true,
      reload: true,
      searchFilter: true,
    };
  } finally {
    if (importedId)
      await query("saves.bulkEdit", {
        ids: [importedId],
        operation: { kind: "purge" },
      });
    await run(
      `window.pond.query('settings.setPrefs', { preferences: { soundsEnabled: ${JSON.stringify(originalDevice.preferences.soundsEnabled)} }, feedback: { sounds: ${JSON.stringify(originalDevice.feedback.sounds)} } })`,
    );
    assert.equal(
      (await query("settings.getPrefs")).preferences.soundsEnabled,
      originalHost.preferences.soundsEnabled,
    );
    if (debuggerApi.isAttached()) debuggerApi.detach();
    writeFileSync(
      join(evidence, `release-${platform}-results.json`),
      JSON.stringify(results, null, 2),
      { mode: 0o600 },
    );
  }
  console.log("WEB_RELEASE_BROWSER_PASSED", JSON.stringify(results));
};
