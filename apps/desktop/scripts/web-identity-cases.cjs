const assert = require("node:assert/strict");
const { readFileSync, writeFileSync } = require("node:fs");
const { basename, dirname, join, resolve, sep } = require("node:path");
const { setTimeout: pause } = require("node:timers/promises");
const sharp = require("sharp");

const customize = '[role="dialog"][aria-label="Customize Library"]';
const nameField = `${customize} input[maxlength="255"]`;

exports.verifyBrowserIdentity = async function verifyBrowserIdentity({
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
  settingsOnly = false,
}) {
  const initial = await query("library.info");
  assert.ok(
    resolve(initial.path).startsWith(`${resolve(sandbox)}${sep}`),
    "Identity smoke may only rename the disposable sandbox Library.",
  );
  assert.match(basename(initial.path), /\.pond$/i);
  const originalFolder = basename(initial.path).replace(/\.pond$/i, "");
  const originalId = JSON.parse(
    readFileSync(join(initial.path, "metadata.json"), "utf8"),
  ).id;
  const prefix = `Circe identity ${process.pid}-${Date.now()}`;
  const fixture = join(evidence, "library-logo-ui-fixture.png");
  const invalid = join(evidence, "library-logo-invalid-fixture.png");
  writeFileSync(
    fixture,
    await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 4,
        background: "#458d74",
      },
    })
      .png()
      .toBuffer(),
  );
  writeFileSync(invalid, "This is deliberately not an image.");
  // A bounded test can still be interrupted; retain non-secret recovery state.
  const restoreRecord = (restored) =>
    writeFileSync(
      join(evidence, "library-identity-restore.json"),
      JSON.stringify({ ...initial, libraryId: originalId, restored }, null, 2),
      { mode: 0o600 },
    );
  restoreRecord(false);

  const key = (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  };
  const replaceInput = async (selector, value) => {
    await click(selector);
    await waitFor(
      `document.activeElement === document.querySelector(${JSON.stringify(selector)})`,
    );
    // This standalone window has no application Edit menu accelerator.
    win.webContents.selectAll();
    // Selection and IME insertion travel through separate renderer commands.
    // Observe the selection before replacing text, especially after relaunch.
    try {
      await waitFor(
        `(() => {const input=document.querySelector(${JSON.stringify(selector)});return document.hasFocus() && document.activeElement===input && input.selectionStart===0 && input.selectionEnd===input.value.length;})()`,
      );
      await win.webContents.insertText(value);
      await waitFor(
        `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`,
      );
    } catch (error) {
      console.error(
        "WEB_IDENTITY_INPUT_FAILED",
        await run(
          `(() => {const input=document.querySelector(${JSON.stringify(selector)});return {value:input?.value,disabled:input?.disabled,focused:document.activeElement===input,documentFocused:document.hasFocus(),selection:[input?.selectionStart,input?.selectionEnd]};})()`,
        ),
      );
      throw error;
    }
  };
  const clickText = async (selector, text) => {
    await waitFor(
      `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(node => node.textContent?.trim() === ${JSON.stringify(text)} && node.getBoundingClientRect().width > 0)`,
    );
    await run(`(() => {
      document.querySelectorAll('[data-identity-control]').forEach(node => node.removeAttribute('data-identity-control'));
      const node = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node => node.textContent?.trim() === ${JSON.stringify(text)} && node.getBoundingClientRect().width > 0);
      if (!node) throw new Error('Missing identity control');
      node.setAttribute('data-identity-control', 'target');
    })()`);
    await click('[data-identity-control="target"]');
  };
  const waitUntil = async (check, description, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const result = await check();
        if (result) return result;
      } catch {
        // Restart replaces both the socket and the browser execution context.
      }
      await pause(150);
    }
    throw new Error(`Identity smoke timed out: ${description}`);
  };
  const instance = async () => {
    const response = await fetch(`${origin}/web/ready`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.match(result.instance, /./);
    return result.instance;
  };
  const debuggerApi = win.webContents.debugger;
  debuggerApi.attach("1.3");
  await debuggerApi.sendCommand("Page.enable");
  await debuggerApi.sendCommand("Page.setInterceptFileChooserDialog", {
    enabled: true,
  });
  const pickFile = async (activate, file) => {
    let listener;
    let timer;
    const opened = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("The identity file chooser did not open.")),
        15000,
      );
      listener = (_event, method, params) => {
        if (method === "Page.fileChooserOpened") resolve(params);
      };
      debuggerApi.on("message", listener);
    });
    try {
      const [, chosen] = await Promise.all([activate(), opened]);
      assert.equal(chosen.mode, "selectSingle");
      await debuggerApi.sendCommand("DOM.setFileInputFiles", {
        backendNodeId: chosen.backendNodeId,
        files: file ? [file] : [],
      });
      if (!file) {
        // CDP leaves an unchanged empty picker pending; deliver its standard cancel event.
        await run(`(() => {
          const input = document.querySelector('input[type="file"]:not(#host-key-file)');
          if (input) input.dispatchEvent(new Event('cancel', { bubbles: true }));
        })()`);
      }
    } finally {
      clearTimeout(timer);
      debuggerApi.removeListener("message", listener);
    }
  };
  const connect = async ({
    previous,
    previousDocument,
    navigate = false,
  } = {}) => {
    await waitUntil(async () => {
      const next = await instance();
      return !previous || next !== previous;
    }, "a ready replacement host");
    if (navigate) await win.loadURL(origin);
    const login = "Boolean(document.querySelector('#host-key-file'))";
    const connected =
      'Boolean(document.querySelector(\'[aria-label="Library Menu"], [aria-label="Library Name"], [data-library-search]\'))';
    await waitUntil(
      () =>
        run(
          `${previousDocument === undefined ? "true" : `performance.timeOrigin !== ${previousDocument}`} && ((${login}) || (${connected}))`,
        ),
      "the browser connection page or restored Library session",
    );
    if (await run(login)) {
      await pickFile(
        () => click("#host-key-file"),
        join(sandbox, "web-access-key"),
      );
      await waitUntil(
        () => run(connected),
        "login through the access-key file control",
      );
    }
    const session = await refreshSession();
    assert.equal(session.libraryId, originalId);
  };
  const openCustomizer = async () => {
    await win.loadURL(origin);
    await waitFor(
      "document.querySelector('[data-library-search]') || Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Exit settings')",
    );
    if (
      await run(
        "Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Exit settings')",
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
    await clickText('[role="menuitem"]', "Customize Library");
    await waitFor(`document.querySelector(${JSON.stringify(customize)})`);
  };
  const logoMenu = async (label) => {
    await click(`${customize} [aria-label="Edit Logo"]`);
    await clickText('[role="menuitem"]', label);
  };
  const icon = async () => {
    await logoMenu("Choose Icon");
    await click('[aria-label="Choose Icon"] button[aria-label="Rocket"]');
    key("Escape");
    await waitFor(
      `!document.querySelector('[aria-label="Choose Icon"]') && document.querySelector(${JSON.stringify(customize)})`,
    );
    await click(`${customize} [role="radio"][aria-label="Bright Teal"]`);
    await waitFor(
      `document.querySelector(${JSON.stringify(`${customize} [data-mark="icon:rocket"] svg`)})`,
    );
  };
  const save = async () => {
    await click(`${customize} button[type="submit"]`);
    await waitFor(`!document.querySelector(${JSON.stringify(customize)})`);
  };
  const cancel = async () => {
    await clickText(`${customize} button`, "Cancel");
    await waitFor(`!document.querySelector(${JSON.stringify(customize)})`);
  };
  const verify = async (expected) => {
    const value = await waitUntil(
      async () => {
        const current = await query("library.info");
        return (
          Object.entries(expected).every(
            ([field, value]) =>
              JSON.stringify(current[field]) === JSON.stringify(value),
          ) && current
        );
      },
      "persisted Library identity",
      20000,
    );
    const metadata = JSON.parse(
      readFileSync(join(value.path, "metadata.json"), "utf8"),
    );
    assert.equal(metadata.id, originalId);
    assert.equal(
      metadata.name ?? basename(value.path).replace(/\.pond$/i, ""),
      value.name,
    );
    assert.equal(metadata.icon ?? null, value.icon);
    assert.deepEqual(metadata.mark ?? null, value.mark);
    if (value.icon) {
      const bytes = Buffer.from(value.icon.split(",")[1], "base64");
      const image = await sharp(bytes).metadata();
      assert.equal(image.format, "png");
      assert.equal(image.width, 256);
      assert.equal(image.height, 256);
      if (value.mark) {
        const statistics = await sharp(bytes).stats();
        assert.ok(
          statistics.channels.some((channel) => channel.stdev > 10),
          "A saved icon or emoji must contain its rendered glyph.",
        );
      }
      await waitFor(
        `document.querySelector('link[rel="icon"]')?.href === ${JSON.stringify(value.icon)}`,
      );
    }
    return value;
  };
  const renameFromDialog = async (name, mark) => {
    await openCustomizer();
    if (mark) await icon();
    await replaceInput(nameField, name);
    const previous = await instance();
    const previousDocument = await run("performance.timeOrigin");
    await click(`${customize} button[type="submit"]`);
    await connect({ previous, previousDocument });
    const expected = { name };
    if (mark) expected.mark = mark;
    const value = await verify(expected);
    assert.equal(basename(value.path), `${name}.pond`);
    assert.equal(dirname(value.path), dirname(initial.path));
    await waitFor(
      `document.querySelector('[aria-label="Library Menu"]')?.textContent.includes(${JSON.stringify(name)})`,
    );
  };

  const rocket = { kind: "icon", icon: "rocket", color: "teal-bright" };
  let failure;
  try {
    if (!settingsOnly) {
      await win.loadURL(`${origin}/settings/library`);
      const choose = '[aria-label="Choose Logo"], [aria-label="Change Logo"]';
      await waitFor(`document.querySelector(${JSON.stringify(choose)})`);
      await pickFile(() => click(choose), fixture);
      await waitFor(
        "document.querySelector('[aria-label=\"Change Logo\"] img')?.naturalWidth === 256 && document.querySelector('link[rel=\"icon\"]').href.startsWith('data:image/png;base64,')",
      );
      const uploaded = await verify({ name: initial.name, mark: null });
      await snapshot("library-logo-changed");
      await win.loadURL(`${origin}/settings/library`);
      await waitFor(
        `document.querySelector('[aria-label="Change Logo"] img')?.src === ${JSON.stringify(uploaded.icon)}`,
      );
      await snapshot("library-logo-reloaded");
      await clickText("#setting-library-logo button", "Reset");
      await verify({ name: initial.name, icon: null, mark: null });
      await snapshot("library-logo-reset");

      const baseline = await query("library.info");
      await openCustomizer();
      await replaceInput(nameField, `${prefix} cancelled`);
      await icon();
      // Automatic asks must respect this local dialog throughout an editing session.
      await pause(21_000);
      assert.equal(
        await run(
          `document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length`,
        ),
        1,
      );
      assert.equal(
        await run(
          `document.querySelector(${JSON.stringify(nameField)})?.value`,
        ),
        `${prefix} cancelled`,
      );
      await cancel();
      assert.deepEqual(await query("library.info"), baseline);

      await openCustomizer();
      await icon();
      await save();
      await verify({ name: initial.name, mark: rocket });
      await snapshot("library-icon-saved");
      await openCustomizer();
      await waitFor(
        `document.querySelector(${JSON.stringify(`${customize} [data-mark="icon:rocket"]`)}) && document.querySelector(${JSON.stringify(`${customize} [role="radio"][aria-label="Bright Teal"]`)})?.getAttribute('aria-checked') === 'true'`,
      );
      await cancel();

      await openCustomizer();
      await logoMenu("Choose Emoji");
      await click('[aria-label="Choose Emoji"] button[aria-label="Whale"]');
      await click(`${customize} [role="radio"][aria-label="Navy"]`);
      await save();
      const whale = { kind: "emoji", emoji: "🐳", color: "navy" };
      const emojiIdentity = await verify({ name: initial.name, mark: whale });
      await snapshot("library-emoji-saved");
      await openCustomizer();
      await waitFor(
        `document.querySelector(${JSON.stringify(`${customize} [data-mark="emoji:🐳"]`)})`,
      );
      await pickFile(() => logoMenu("Upload Image"), invalid);
      await waitFor(
        `document.querySelector(${JSON.stringify(`${customize} [role="alert"]`)})?.textContent.includes('Choose a supported image')`,
      );
      assert.deepEqual(await query("library.info"), emojiIdentity);
      await snapshot("library-logo-invalid");
      await pickFile(() => logoMenu("Upload Image"), null);
      await waitFor(
        `!document.querySelector('input[type="file"]:not(#host-key-file)') && document.querySelector(${JSON.stringify(`${customize} [data-mark="emoji:🐳"]`)})`,
      );
      assert.deepEqual(await query("library.info"), emojiIdentity);
      await pickFile(() => logoMenu("Upload Image"), fixture);
      await waitFor(
        `document.querySelector(${JSON.stringify(`${customize} [data-mark^="image:"] img`)})?.naturalWidth === 256`,
      );
      await save();
      await verify({ name: initial.name, mark: null });
      await snapshot("library-customizer-upload-retried");

      await renameFromDialog(`${prefix} name`, null);
      await snapshot("library-name-reconnected");
      await renameFromDialog(`${prefix} combined`, rocket);
      await snapshot("library-name-icon-reconnected");
    }

    await win.loadURL(`${origin}/settings/library`);
    await waitFor("document.querySelector('[aria-label=\"Library Name\"]')");
    const settingsName = `${prefix} settings`;
    console.log("WEB_IDENTITY_SETTINGS_STAGE", "ready");
    await replaceInput('[aria-label="Library Name"]', settingsName);
    console.log("WEB_IDENTITY_SETTINGS_STAGE", "typed");
    const previous = await instance();
    const previousDocument = await run("performance.timeOrigin");
    key("Enter");
    await connect({ previous, previousDocument });
    console.log("WEB_IDENTITY_SETTINGS_STAGE", "reconnected");
    const renamed = await verify({
      name: settingsName,
      mark: settingsOnly ? initial.mark : rocket,
    });
    assert.equal(basename(renamed.path), `${settingsName}.pond`);
    await waitFor(
      `document.querySelector('[aria-label="Library Name"]')?.value === ${JSON.stringify(settingsName)}`,
    );
    await snapshot("library-settings-name-reconnected");
    const stableInstance = await instance();
    await replaceInput('[aria-label="Library Name"]', `${prefix} discarded`);
    key("Escape");
    key("Tab");
    await waitFor(
      `document.querySelector('[aria-label="Library Name"]')?.value === ${JSON.stringify(settingsName)}`,
    );
    assert.equal((await query("library.info")).name, settingsName);
    assert.equal(await instance(), stableInstance);
  } catch (error) {
    failure = error;
    console.error("WEB_IDENTITY_CASE_FAILED", error.message);
    try {
      await snapshot("library-identity-failed");
    } catch {
      // A failed navigation may leave no document to capture before recovery.
    }
  } finally {
    try {
      await connect({ navigate: true });
      let current = await query("library.info");
      assert.equal(dirname(current.path), dirname(initial.path));
      if (current.path !== initial.path) {
        const previous = await instance();
        const result = await query("library.rename", { name: originalFolder });
        assert.equal(
          result.ok,
          true,
          "Restore the original sandbox Library folder.",
        );
        if (result.restarting) await connect({ previous, navigate: true });
        else await connect({ navigate: true });
      }
      await query("library.identity.update", {
        name: initial.name,
        icon: initial.icon,
        mark: initial.mark,
        accent: initial.accent,
      });
      current = await query("library.info");
      assert.deepEqual(current, initial);
      restoreRecord(true);
    } catch (error) {
      console.error("WEB_IDENTITY_RESTORE_FAILED", error.message);
      failure = failure
        ? new AggregateError(
            [failure, error],
            "Identity verification and restoration failed.",
          )
        : error;
    } finally {
      if (debuggerApi.isAttached()) debuggerApi.detach();
    }
  }
  if (failure) throw failure;
  console.log(
    settingsOnly
      ? "WEB_IDENTITY_SETTINGS_PASSED"
      : "WEB_IDENTITY_BROWSER_PASSED",
    JSON.stringify({
      ...(!settingsOnly && {
        devicePicker: true,
        customFavicon: true,
        reload: true,
        reset: true,
        cancel: true,
        invalidImage: true,
        icon: true,
        emoji: true,
        name: true,
        combinedNameAndMark: true,
      }),
      settingsName: true,
      restartReconnect: true,
      restored: true,
    }),
  );
};
