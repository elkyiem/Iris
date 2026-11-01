const assert = require("node:assert/strict");
const {
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} = require("node:fs");
const { join, sep } = require("node:path");

const SPECIES = [
  ["koi", "Koi"],
  ["goldfish", "Goldfish"],
  ["puffer", "Puffer"],
  ["clownfish", "Clownfish"],
  ["angelfish", "Angelfish"],
  ["shark", "Shark"],
  ["anglerfish", "Anglerfish"],
  ["sunfish", "Sunfish"],
  ["swordfish", "Swordfish"],
  ["seahorse", "Seahorse"],
  ["betta", "Betta"],
  ["manta", "Manta Ray"],
  ["eel", "Eel"],
  ["catfish", "Catfish"],
  ["lionfish", "Lionfish"],
];
const COLORS = [
  "Red",
  "Orange",
  "Gold",
  "Yellow",
  "Lime",
  "Green",
  "Jade",
  "Teal",
  "Cyan",
  "Blue",
  "Indigo",
  "Violet",
  "Purple",
  "Magenta",
  "Pink",
];

exports.verifyUpgradeFish = async function verifyUpgradeFish({
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
  const sandboxRoot = realpathSync(sandbox);
  assert.ok(sandboxRoot.includes("upgrade-220"));
  assert.ok(realpathSync(library.path).startsWith(`${sandboxRoot}${sep}`));
  const initialPrefs = await query("settings.getPrefs");
  assert.equal(
    initialPrefs.preferences.reduceMotion,
    "system",
    "Use a disposable profile with Match System motion preferences for CDP media emulation.",
  );
  const debuggerApi = win.webContents.debugger;
  assert.equal(
    debuggerApi.isAttached(),
    false,
    "The Fish case must own its CDP media-emulation session.",
  );
  const originalSize = win.getSize();
  const proof = { species: [], colors: [], frames: {}, checks: [] };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const key = (keyCode) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
  };
  const poll = async (label, inspect) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const result = await inspect();
      if (result) return result;
      await pause(100);
    }
    assert.fail(label);
  };
  const nameSelector = '[data-slot="right"] input[aria-label="Name"]';
  const triggerSelector = 'button[aria-label="Species and Color"]';
  const details = async () => {
    await waitFor("document.querySelector('[aria-label=\"Toggle Details\"]')");
    if (
      !(await run(
        "Boolean(document.querySelector('[data-slot=window][data-right-open]'))",
      ))
    )
      await click('[aria-label="Toggle Details"]');
    await waitFor(`document.querySelector(${JSON.stringify(nameSelector)})`);
  };
  const reload = async () => {
    const loaded = new Promise((resolve) =>
      win.webContents.once("did-finish-load", resolve),
    );
    win.reload();
    await loaded;
    await details();
  };
  const openPicker = async () => {
    await click(triggerSelector);
    await waitFor("document.querySelector('button[aria-label=\"Seahorse\"]')");
  };
  const closePicker = async () => {
    key("Escape");
    await waitFor("!document.querySelector('button[aria-label=\"Seahorse\"]')");
  };
  let fishId;
  const savedFish = async () =>
    (await query("fish.list")).find((fish) => fish.id === fishId);
  const persisted = async (expected) => {
    await poll(`Fish did not persist ${JSON.stringify(expected)}`, async () => {
      const fish = await savedFish();
      return (
        fish &&
        Object.entries(expected).every(
          ([field, value]) => fish[field] === value,
        )
      );
    });
    const envelope = JSON.parse(
      readFileSync(join(library.path, "fish.json"), "utf8"),
    );
    const stored = envelope.data.find((fish) => fish.id === fishId);
    assert.ok(stored, "The Fish must exist in its real Library bundle.");
    for (const [field, value] of Object.entries(expected))
      assert.equal(stored[field], value);
  };
  const choose = async (label, field, value) => {
    const selector = `button[aria-pressed][aria-label="${label}"]`;
    await click(selector);
    await waitFor(
      `document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed') === 'true'`,
    );
    await persisted({ [field]: value });
  };
  const markAvatar = async () => {
    await waitFor(`(() => {
      const trigger = document.querySelector(${JSON.stringify(triggerSelector)});
      const svg = [...(trigger?.parentElement?.querySelectorAll('svg') ?? [])].find(node => node.querySelector('clipPath'));
      if (!svg) return false;
      svg.setAttribute('data-upgrade220-fish', ''); return true;
    })()`);
  };
  const frames = async () =>
    run(`(async () => {
    const svg = document.querySelector('[data-upgrade220-fish]');
    if (!svg) throw new Error('The visible Fish avatar disappeared');
    const samples = [];
    for (let index = 0; index < 12; index++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      samples.push(JSON.stringify([...svg.querySelectorAll('g,path')].map(node => [node.getAttribute('d'),node.getAttribute('transform'),node.getAttribute('opacity')])));
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return samples;
  })()`);
  const media = async (value) => {
    await debuggerApi.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value }],
    });
    await waitFor(
      `document.documentElement.hasAttribute('data-reduce-motion') === ${value === "reduce"}`,
    );
  };
  debuggerApi.attach("1.3");
  try {
    await media("no-preference");
    win.setSize(1280, 900);
    await win.loadURL(`${origin}/?q=`);
    await waitFor("document.querySelector('[data-library-search]')");
    if (
      !(await run(
        "Boolean(document.querySelector('[data-slot=window][data-left-open]'))",
      ))
    )
      await click('[aria-label="Toggle Sidebar"]');
    const previous = new Set((await query("fish.list")).map((fish) => fish.id));
    await click('[aria-label="New Fish"]');
    const created = await poll("New Fish did not create one Fish", async () => {
      const added = (await query("fish.list")).filter(
        (fish) => !previous.has(fish.id),
      );
      assert.ok(
        added.length <= 1,
        "One New Fish click must not create duplicates.",
      );
      return added.length === 1 && added[0];
    });
    fishId = created.id;
    await waitFor(`location.pathname === '/fish/${fishId}'`);
    await details();
    const name = `Browser Seahorse ${Date.now().toString(36)}`;
    await click(nameSelector);
    await waitFor(
      `document.activeElement === document.querySelector(${JSON.stringify(nameSelector)})`,
    );
    win.webContents.selectAll();
    await waitFor(
      `(() => {const input=document.querySelector(${JSON.stringify(nameSelector)});return document.hasFocus() && document.activeElement===input && input.selectionStart===0 && input.selectionEnd===input.value.length;})()`,
    );
    await win.webContents.insertText(name);
    key("Tab");
    await persisted({ name });
    await openPicker();
    await choose("Seahorse", "species", "seahorse");
    await choose("Cyan", "color", "cyan");
    await snapshot("upgrade220-fish-seahorse-cyan");
    await closePicker();
    await click(nameSelector);
    key("Tab");
    proof.checks.push(
      "New Fish, name, species and color use real UI input and persist in fish.json",
    );

    await markAvatar();
    await waitFor(
      "document.hasFocus() && !document.documentElement.hasAttribute('data-motion-paused')",
    );
    win.webContents.sendInputEvent({ type: "mouseMove", x: 20, y: 20 });
    const idle = await frames();
    assert.ok(
      new Set(idle).size > 1,
      "The visible idle Fish must animate across real frames.",
    );
    const pointer = await run(`(() => {
      const svg=document.querySelector('[data-upgrade220-fish]'); const r=svg.getBoundingClientRect();
      for(let y=1;y<10;y++) for(let x=1;x<10;x++) {
        const point={x:Math.round(r.x+r.width*x/10),y:Math.round(r.y+r.height*y/10)};
        if(svg.contains(document.elementFromPoint(point.x,point.y))) return point;
      }
      throw new Error('No painted Fish pointer target is exposed');
    })()`);
    win.webContents.sendInputEvent({ type: "mouseMove", ...pointer });
    const hovered = await frames();
    assert.ok(
      new Set(hovered).size > 1,
      "The hovered Fish must keep updating its actual SVG pose.",
    );
    proof.frames.idleDistinct = new Set(idle).size;
    proof.frames.hoveredDistinct = new Set(hovered).size;
    await media("reduce");
    const reduced = await frames();
    assert.equal(
      new Set(reduced).size,
      1,
      "Reduced motion must keep the Fish pose stable.",
    );
    proof.frames.reducedDistinct = new Set(reduced).size;
    proof.checks.push(
      "Actual SVG frames animate idle/hovered and stay stable under emulated reduced motion",
    );
    await media("no-preference");
    await reload();
    await waitFor(
      `document.querySelector(${JSON.stringify(nameSelector)})?.value === ${JSON.stringify(name)}`,
    );
    await openPicker();
    await waitFor(
      "document.querySelector('button[aria-label=\"Seahorse\"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('button[aria-label=\"Cyan\"]')?.getAttribute('aria-pressed') === 'true'",
    );
    await closePicker();
    proof.checks.push(
      "Desktop reload restores name and pressed species/color selections",
    );

    win.setSize(390, 844);
    await waitFor("window.innerWidth === 390");
    if (
      await run(
        "Boolean(document.querySelector('[data-slot=window][data-left-open]'))",
      )
    )
      await click('[aria-label="Toggle Sidebar"]');
    await details();
    await openPicker();
    for (const [species, label] of SPECIES) {
      await choose(label, "species", species);
      proof.species.push(species);
    }
    for (const label of COLORS) {
      await choose(label, "color", label.toLowerCase());
      proof.colors.push(label.toLowerCase());
    }
    await choose("Seahorse", "species", "seahorse");
    await choose("Cyan", "color", "cyan");
    await snapshot("upgrade220-fish-phone-picker");
    await closePicker();
    await reload();
    await openPicker();
    await waitFor(
      "document.querySelector('button[aria-label=\"Seahorse\"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('button[aria-label=\"Cyan\"]')?.getAttribute('aria-pressed') === 'true'",
    );
    await persisted({ name, species: "seahorse", color: "cyan" });
    await snapshot("upgrade220-fish-phone-reloaded");
    await closePicker();
    proof.checks.push(
      "All 15 species and 15 colors receive pointer input at 390 CSS pixels; final values survive reload",
    );
    // Routine creation belongs to chat. Seed only this disposable Fish, then exercise its real controls.
    const fishFile = join(library.path, "fish.json");
    const school = JSON.parse(readFileSync(fishFile, "utf8"));
    const fixtureFish = school.data.find((fish) => fish.id === fishId);
    const routineId = `upgrade-${Date.now().toString(36)}`;
    const routineName = "Browser weekly fixture";
    const now = Date.now();
    fixtureFish.routines.push({
      id: routineId,
      name: routineName,
      instruction: "A fixture for routine controls only.",
      when: { kind: "every", hours: 168 },
      paused: true,
      lastRun: {
        routineId,
        routineName,
        chatId: null,
        at: now,
        status: "done",
        changes: 0,
        seen: true,
      },
      createdAt: now,
      updatedAt: now,
    });
    school.updatedAt = now;
    const temporary = join(library.path, ".upgrade-220-fish-fixture.tmp");
    writeFileSync(temporary, JSON.stringify(school), { mode: 0o600 });
    renameSync(temporary, fishFile);
    await reload();
    await click(`[role="switch"][aria-label="Resume ${routineName}"]`);
    await poll(
      "Routine resume persists through the host",
      async () =>
        (await query("fish.list"))
          .find((fish) => fish.id === fishId)
          ?.routines.find((routine) => routine.id === routineId)?.paused ===
        false,
    );
    await waitFor(
      `document.querySelector('[role="switch"][aria-label="Pause ${routineName}"]')?.getAttribute('aria-checked') === 'true'`,
    );
    await click(`[role="switch"][aria-label="Pause ${routineName}"]`);
    await poll(
      "Routine pause persists through the host",
      async () =>
        (await query("fish.list"))
          .find((fish) => fish.id === fishId)
          ?.routines.find((routine) => routine.id === routineId)?.paused ===
        true,
    );
    await reload();
    await waitFor(
      `document.querySelector('[role="switch"][aria-label="Resume ${routineName}"]')?.getAttribute('aria-checked') === 'false'`,
    );
    await run(
      `(() => { const row=[...document.querySelectorAll('[data-slot=right] button')].find(button=>[...button.querySelectorAll('span')].some(span=>span.textContent === ${JSON.stringify(routineName)}));if(!row)throw new Error('Missing routine row');row.setAttribute('data-upgrade-routine-row',''); })()`,
    );
    await click("[data-upgrade-routine-row]");
    await waitFor(
      `document.querySelector('[data-slot=right] h2')?.textContent === ${JSON.stringify(routineName)} && document.querySelector('[data-slot=right]')?.innerText.includes('Every week') && document.querySelector('[data-slot=right]')?.innerText.includes('Paused. It runs only when you ask.')`,
    );
    await snapshot("upgrade220-routine-phone-details");
    proof.checks.push(
      "A seeded weekly routine resumes, pauses, survives reload and opens its details through actual phone-width controls; execution is not triggered",
    );
    writeFileSync(
      join(evidence, "upgrade220-fish-results.json"),
      JSON.stringify(
        {
          ...proof,
          fishId,
          name,
          browser: "Chromium",
          widths: [1280, 390],
          motion:
            "CDP prefers-reduced-motion emulation; no host preference writes",
          limitations: [
            "Not physical Windows or iPad validation",
            "Routine creation/execution requires separate coverage",
            "SVG frame changes do not assert the detailed pointer-following physics",
          ],
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      "WEB_UPGRADE_FISH_PASSED",
      JSON.stringify({
        fishId,
        checks: proof.checks.length,
        species: proof.species.length,
        colors: proof.colors.length,
      }),
    );
  } catch (error) {
    await snapshot("upgrade220-fish-failure").catch(() => {});
    throw error;
  } finally {
    try {
      if (debuggerApi.isAttached())
        await debuggerApi.sendCommand("Emulation.setEmulatedMedia", {
          features: [],
        });
    } finally {
      if (debuggerApi.isAttached()) debuggerApi.detach();
      win.setSize(...originalSize);
    }
  }
};
