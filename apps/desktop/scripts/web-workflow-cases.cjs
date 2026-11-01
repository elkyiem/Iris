const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const sharp = require("sharp");

exports.verifyBrowserWorkflow = async function verifyBrowserWorkflow({
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
  const library = await query("library.info");
  assert.ok(sandbox.includes("sandbox-workflow"));
  assert.ok(library.path.startsWith(`${sandbox}/`));
  assert.equal(
    (await query("saves.listPage", { limit: 100 })).rows.length,
    0,
    "Use a fresh disposable Library for this entire workflow.",
  );
  const directory = join(sandbox, "workflow-inputs");
  mkdirSync(directory, { recursive: true });
  const names = ["Mountain study", "Coastal palette", "Evening light"];
  const colors = ["#52796f", "#219ebc", "#c8553d"];
  const files = [];
  for (let index = 0; index < names.length; index++) {
    const file = join(directory, `${names[index]}.png`);
    await sharp(
      Buffer.from(
        `<svg width="960" height="640" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="640" fill="${colors[index]}"/><circle cx="735" cy="160" r="75" fill="#f9d78b"/><path d="M0 500L280 130L590 550L740 350L960 640H0Z" fill="#223b44"/><text x="50" y="590" fill="white" font-family="Helvetica" font-size="44">${names[index]}</text></svg>`,
      ),
    )
      .png()
      .toFile(file);
    files.push(file);
  }
  const pause = (ms = 850) => new Promise((resolve) => setTimeout(resolve, ms));
  const proofs = [];
  const step = async (label) => {
    console.log("WORKFLOW_STEP", label);
    if (process.env.CIRCE_RECORD_WORKFLOW === "1") {
      await run(`(() => {
        let label = document.getElementById('workflow-recording-label');
        if (!label) {
          label = document.createElement('div'); label.id = 'workflow-recording-label';
          label.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:2147483647;pointer-events:none;padding:10px 16px;border-radius:10px;background:#163d2e;color:white;font:14px system-ui;box-shadow:0 2px 12px #0004';
          document.body.append(label);
        }
        label.textContent = ${JSON.stringify(`Chromium UI test · ${label}`)};
      })()`);
      await pause();
    }
  };
  const key = (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  };
  const text = async (selector, value) => {
    await click(selector);
    await waitFor(
      `document.activeElement === document.querySelector(${JSON.stringify(selector)})`,
    );
    // Standalone Chromium has no application Edit menu accelerator.
    win.webContents.selectAll();
    await win.webContents.insertText(value);
    await waitFor(
      `(() => {const field=document.querySelector(${JSON.stringify(selector)}); return (field.value ?? field.textContent) === ${JSON.stringify(value)};})()`,
    );
    await pause(300);
  };
  const markText = async (
    label,
    roles = '[role="menuitem"],[role="menuitemcheckbox"],button,[role="button"]',
  ) => {
    const expression = `(() => {
      const matches = [...document.querySelectorAll(${JSON.stringify(roles)})].filter(node => node.getBoundingClientRect().width && (node.textContent.trim() === ${JSON.stringify(label)} || [...node.querySelectorAll('span')].some(span => span.textContent.trim() === ${JSON.stringify(label)})));
      if (matches.length !== 1) return false;
      document.querySelector('[data-workflow-target]')?.removeAttribute('data-workflow-target');
      matches[0].setAttribute('data-workflow-target',''); return true;
    })()`;
    await waitFor(expression);
    return "[data-workflow-target]";
  };
  const clickText = async (label, roles) => click(await markText(label, roles));
  const poll = async (label, inspect) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const result = await inspect();
      if (result) {
        proofs.push(label);
        return result;
      }
      await pause(100);
    }
    assert.fail(label);
  };
  const reload = async () => {
    const loaded = new Promise((resolve) =>
      win.webContents.once("did-finish-load", resolve),
    );
    win.reload();
    await loaded;
  };
  const open = async (id) => {
    await click(`[data-save-id="${id}"] [role="option"]`, 2);
    await waitFor(
      `location.pathname === '/save/${id}' && document.querySelector('[data-save-details]')`,
    );
  };
  const details = async () => {
    await waitFor("document.querySelector('[aria-label=\"Toggle Details\"]')");
    if (
      !(await run(
        "Boolean(document.querySelector('[data-slot=window][data-right-open]'))",
      ))
    )
      await click('[aria-label="Toggle Details"]');
    await waitFor(
      "document.querySelector('[data-slot=window][data-right-open]')",
    );
  };
  try {
    await win.loadURL(`${origin}/?q=`);
    await waitFor("document.querySelector('[data-library-search]')");
    await step("1. Import three images using Import Files");
    await click('[aria-label="New"]');
    await waitFor("document.querySelector('[aria-label=\"Search Actions\"]')");
    await win.webContents.insertText("Import Files");
    const debuggerApi = win.webContents.debugger;
    debuggerApi.attach("1.3");
    try {
      await debuggerApi.sendCommand("Page.enable");
      await debuggerApi.sendCommand("Page.setInterceptFileChooserDialog", {
        enabled: true,
      });
      let listener;
      let chooserTimer;
      const chooser = new Promise((resolve, reject) => {
        chooserTimer = setTimeout(
          () =>
            reject(
              new Error("Import Files did not open the Chromium file chooser"),
            ),
          12000,
        );
        listener = (_event, method, params) => {
          if (method === "Page.fileChooserOpened") resolve(params);
        };
        debuggerApi.on("message", listener);
      });
      try {
        const [, selected] = await Promise.all([
          clickText("Import Files", '[role="menuitem"]'),
          chooser,
        ]);
        assert.equal(selected.mode, "selectMultiple");
        await debuggerApi.sendCommand("DOM.setFileInputFiles", {
          backendNodeId: selected.backendNodeId,
          files,
        });
      } finally {
        clearTimeout(chooserTimer);
        debuggerApi.removeListener("message", listener);
      }
    } finally {
      debuggerApi.detach();
    }
    const imported = await poll(
      "Import Files creates three complete image Saves",
      async () => {
        const page = await query("saves.listPage", { limit: 100 });
        return (
          page.rows.length === 3 &&
          page.rows.every((save) => save.files.length) &&
          page.rows
        );
      },
    );
    const image = imported.find((save) => save.title.includes("Mountain"));
    assert.ok(image);
    await waitFor("document.querySelectorAll('[data-save-id]').length === 3");
    await snapshot("workflow-imported");
    await step("2. Search for Mountain study and open its image");
    await text("[data-library-search]", "Mountain");
    await waitFor(
      `document.querySelectorAll('[data-save-id]').length === 1 && document.querySelector('[data-save-id="${image.id}"]')`,
    );
    proofs.push(
      "Search filters three imported Saves down to the matching image",
    );
    await pause();
    await open(image.id);
    await waitFor(
      "[...document.querySelectorAll('[data-save-details] img')].some(img => img.complete && img.naturalWidth === 960)",
    );
    await details();
    await step("3. Edit the title, add a note and create a tag");
    const title = "Mountain inspiration";
    const notes = "Saved from Chromium. Use this palette for the next design.";
    await text('[aria-label="Title"]', title);
    await text('[aria-label="Notes"]', notes);
    await click('[aria-label="Add Tag"]');
    await text('[aria-label="Search Tags"]', "Inspiration");
    await clickText("Create “Inspiration”", '[role="menuitem"]');
    key("Escape");
    await poll(
      "Title, note and new tag are persisted by the host",
      async () => {
        const saved = await query("saves.get", { id: image.id });
        return (
          saved.title === title &&
          saved.notes === notes &&
          saved.tags.includes("Inspiration")
        );
      },
    );
    await snapshot("workflow-edited");
    await step("4. Reload and verify the edits survived");
    await reload();
    await details();
    await waitFor(
      `document.querySelector('[aria-label="Title"]')?.value === ${JSON.stringify(title)} && document.querySelector('[aria-label="Notes"]')?.value === ${JSON.stringify(notes)} && document.querySelector('[aria-label="Remove tag Inspiration"]')`,
    );
    proofs.push("Reloaded UI contains the edited title, note and tag");
    await step("5. Create a folder and put this Save inside it");
    await click('[aria-label="Add Folder"]');
    await text('[aria-label="Search Folders"]', "Design references");
    await clickText("Create “Design references”", '[role="menuitem"]');
    key("Escape");
    const folder = await poll(
      "Folder is created and the image is assigned through the UI",
      async () => {
        const created = (await query("folders.list")).find(
          (row) => row.name === "Design references",
        );
        return (
          created &&
          (await query("folders.memberships")).some(
            (row) => row.folderId === created.id && row.saveId === image.id,
          ) &&
          created
        );
      },
    );
    await click('[aria-label="Back"]');
    if (
      await run(
        "Boolean(document.querySelector('[aria-label=\"Clear Search\"]'))",
      )
    )
      await click('[aria-label="Clear Search"]');
    await click(`[data-folder-sortable="${folder.id}"] [role="treeitem"]`);
    await waitFor(
      `new URLSearchParams(location.search).get('folder') === '${folder.id}' && document.querySelectorAll('[data-save-id]').length === 1`,
    );
    await reload();
    await waitFor(
      `document.querySelector('[aria-label="Breadcrumb"]')?.innerText.includes('Design references') && document.querySelector('[data-save-id="${image.id}"]')`,
    );
    proofs.push("Folder view and image membership survive reload");
    await snapshot("workflow-folder-reloaded");
    await step("6. Add the Save to a new Canvas");
    const cardSelector = `[data-save-id="${image.id}"] [role="option"]`;
    await click(cardSelector);
    const cardPoint = await run(
      `(() => { const node=document.querySelector(${JSON.stringify(cardSelector)}); const rect=node.getBoundingClientRect(); const point={x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}; if(!node.contains(document.elementFromPoint(point.x,point.y))) throw new Error('Save context-menu target is covered'); return point; })()`,
    );
    win.webContents.sendInputEvent({
      type: "mouseDown",
      button: "right",
      clickCount: 1,
      ...cardPoint,
    });
    win.webContents.sendInputEvent({
      type: "mouseUp",
      button: "right",
      clickCount: 1,
      ...cardPoint,
    });
    await clickText("Add to Canvas");
    await clickText("New Canvas", '[role="menuitem"]');
    await waitFor("document.querySelector('[aria-label=\"Canvas name\"]')");
    await text('[aria-label="Canvas name"]', "Design board");
    key("Enter");
    await waitFor(
      "document.querySelector('[role=application][aria-roledescription=canvas] .react-flow__node')",
    );
    const canvasId = new URL(win.webContents.getURL()).pathname
      .split("/")
      .at(-1);
    const before = await query("canvases.get", { id: canvasId });
    const item = before.items.find(
      (entry) => entry.kind === "save" && entry.saveId === image.id,
    );
    assert.ok(item);
    await step("7. Drag the image card across the Canvas");
    const selector = `.react-flow__node[data-id="${item.id}"]`;
    await click(selector);
    const start = await run(
      `(() => { const node=document.querySelector(${JSON.stringify(selector)}); const rect=node.getBoundingClientRect(); const point={x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}; if(!node.contains(document.elementFromPoint(point.x,point.y))) throw new Error('Canvas drag target is covered'); return point; })()`,
    );
    win.webContents.sendInputEvent({ type: "mouseMove", ...start });
    win.webContents.sendInputEvent({
      type: "mouseDown",
      button: "left",
      clickCount: 1,
      ...start,
    });
    for (let index = 1; index <= 24; index++) {
      win.webContents.sendInputEvent({
        type: "mouseMove",
        button: "left",
        x: start.x + index * 6,
        y: start.y + index * 3,
      });
      await pause(30);
    }
    win.webContents.sendInputEvent({
      type: "mouseUp",
      button: "left",
      clickCount: 1,
      x: start.x + 144,
      y: start.y + 72,
    });
    const moved = await poll(
      "Dragging moves the Canvas item and persists its position",
      async () => {
        const current = (
          await query("canvases.get", { id: canvasId })
        ).items.find((entry) => entry.id === item.id);
        return (
          Math.abs(current.x - item.x) > 20 &&
          Math.abs(current.y - item.y) > 20 &&
          current
        );
      },
    );
    await snapshot("workflow-canvas-moved");
    await step("8. Reload the Canvas and verify the card position");
    await reload();
    await waitFor(`document.querySelector(${JSON.stringify(selector)})`);
    const restored = await query("canvases.get", { id: canvasId });
    assert.deepEqual(
      restored.items.find((entry) => entry.id === item.id),
      moved,
    );
    const position = await run(
      `(() => { const transform=document.querySelector(${JSON.stringify(selector)}).style.transform; return transform; })()`,
    );
    assert.match(
      position,
      new RegExp(`translate\\(${moved.x}px, ?${moved.y}px\\)`),
    );
    proofs.push("Reloaded Canvas renders the saved card coordinates");
    await snapshot("workflow-canvas-reloaded");
    await step(
      "Passed: import, search, editing, tags, folder and Canvas persistence",
    );
    await pause(1800);
    writeFileSync(
      join(evidence, "workflow-results.json"),
      JSON.stringify(
        {
          proofs,
          imageId: image.id,
          folderId: folder.id,
          canvasId,
          before: { x: item.x, y: item.y },
          after: { x: moved.x, y: moved.y },
          mutations:
            "Chromium pointer/keyboard input and browser file chooser; query calls are reads only",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log("WEB_WORKFLOW_PASSED", JSON.stringify(proofs));
  } catch (error) {
    await snapshot("workflow-failure").catch(() => {});
    throw error;
  }
};
