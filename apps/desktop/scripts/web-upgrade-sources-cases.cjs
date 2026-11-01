const assert = require("node:assert/strict");
const { realpathSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { isAbsolute, join, relative, sep } = require("node:path");
const { setTimeout: pause } = require("node:timers/promises");
const sharp = require("sharp");

exports.verifyUpgradeSources = async function verifyUpgradeSources({
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
  const root = realpathSync(sandbox);
  const library = realpathSync((await query("library.info")).path);
  const contained = relative(root, library);
  assert.ok(root.includes("upgrade-220"));
  assert.ok(
    contained &&
      contained !== ".." &&
      !contained.startsWith(`..${sep}`) &&
      !isAbsolute(contained),
    "Use an isolated upgrade-220 Library, never a personal Library.",
  );
  const nonce = Date.now().toString(36);
  const title = `Circé RSS upgrade ${nonce}`;
  const atomTitle = `Circé Atom upgrade ${nonce}`;
  const watches = new Set();
  const checks = [];
  const requests = new Map();
  let result;
  const image = await sharp({
    create: { width: 960, height: 640, channels: 3, background: "#52796f" },
  })
    .png()
    .toBuffer();
  let fixture;
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", fixture ?? "http://127.0.0.1")
      .pathname;
    requests.set(path, (requests.get(path) ?? 0) + 1);
    response.setHeader("Cache-Control", "no-store");
    if (path === "/feed.xml") {
      response.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
      response.end(
        `<rss version="2.0"><channel><title>${title}</title><item><title>${title}</title><link>${fixture}/article/rss</link></item><item><link>${fixture}/article/rss#duplicate</link></item></channel></rss>`,
      );
    } else if (path === "/atom.xml") {
      response.setHeader("Content-Type", "application/atom+xml; charset=utf-8");
      response.end(
        `<feed xmlns="http://www.w3.org/2005/Atom" xml:base="${fixture}/article/"><title>${atomTitle}</title><entry><id>urn:circe:${nonce}</id><title>${atomTitle}</title><link rel="alternate" href="atom"/></entry></feed>`,
      );
    } else if (path === "/cover.png") {
      response.setHeader("Content-Type", "image/png");
      response.end(image);
    } else if (path === "/not-a-feed") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        "<!doctype html><title>Not a feed</title><p>This is an HTML page.</p>",
      );
    } else if (path === "/article/rss" || path === "/article/atom") {
      const name = path.endsWith("rss") ? title : atomTitle;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><meta property="og:title" content="${name}"><meta property="og:type" content="article"><meta property="og:url" content="${fixture}${path}"><meta property="og:image" content="${fixture}/cover.png"><meta name="description" content="An offline article used to verify RSS ingestion through the Circé host."></head><body style="font:20px system-ui;margin:40px;max-width:960px"><article><h1>${name}</h1><p>This deterministic article tests the real watch, harvest and persistence pipeline. It has no external assets, credentials or live Source dependencies.</p><img src="/cover.png" width="960" height="640" alt="Green landscape study"><p>RSS and Atom entries should produce one stored Save each, retain the correct watch owner, and remain visible after a browser reload.</p></article></body></html>`,
      );
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address?.port);
  fixture = `http://127.0.0.1:${address.port}`;
  const feedUrl = `${fixture}/feed.xml`;
  const articleUrl = `${fixture}/article/rss`;
  const key = (keyCode) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
  };
  const text = async (selector, value) => {
    await click(selector);
    await waitFor(
      `document.activeElement === document.querySelector(${JSON.stringify(selector)})`,
    );
    win.webContents.selectAll();
    await waitFor(
      `(() => {const input=document.querySelector(${JSON.stringify(selector)});return document.hasFocus() && document.activeElement===input && input.selectionStart===0 && input.selectionEnd===input.value.length;})()`,
    );
    await win.webContents.insertText(value);
    await waitFor(
      `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`,
    );
  };
  const clickText = async (label, selector = '[role="menuitem"],button') => {
    await waitFor(`(() => {
      const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(node => node.getBoundingClientRect().width && (node.textContent.trim() === ${JSON.stringify(label)} || [...node.querySelectorAll('span')].some(span=>span.textContent.trim() === ${JSON.stringify(label)})));
      if(nodes.length !== 1) return false;
      document.querySelector('[data-upgrade-sources-control]')?.removeAttribute('data-upgrade-sources-control');
      nodes[0].setAttribute('data-upgrade-sources-control',''); return true;
    })()`);
    await click("[data-upgrade-sources-control]");
  };
  const newAction = async (label) => {
    await click('[aria-label="New"]');
    await waitFor("document.querySelector('[aria-label=\"Search Actions\"]')");
    await text('[aria-label="Search Actions"]', label);
    await clickText(label, '[role="menuitem"]');
  };
  const poll = async (label, inspect, milliseconds = 60000) => {
    const until = Date.now() + milliseconds;
    while (Date.now() < until) {
      const result = await inspect();
      if (result) return result;
      await pause(150);
    }
    assert.fail(`Upgrade acceptance timed out: ${label}`);
  };
  const savedAt = (save) => JSON.stringify(save.savedAt);
  const rowsFor = async (url) =>
    (await query("saves.listPage", { limit: 500 })).rows.filter(
      (row) => row.url === url,
    );
  const readWatch = async (id) =>
    (await query("watches.list")).watches.find((row) => row.id === id);
  const settle = async (id) =>
    poll("watch settles successfully", async () => {
      const watch = await readWatch(id);
      return (
        watch &&
        !watch.syncing &&
        watch.sync.lastSyncedAt &&
        !watch.sync.lastError &&
        watch
      );
    });
  const loadLibrary = async () => {
    await win.loadURL(`${origin}/?q=`);
    await waitFor("document.querySelector('[data-library-search]')");
  };
  const prove = async (name, surface) => {
    checks.push({ name, surface });
    console.log("UPGRADE220_SOURCE_CHECK", surface, name);
    await snapshot(`upgrade220-${name}`);
  };
  try {
    await loadLibrary();
    await newAction("RSS Feed");
    await waitFor(
      "[...document.querySelectorAll('[role=dialog]')].some(node=>node.innerText.includes('Watch an RSS Feed'))",
    );
    await text('[aria-label="Link or handle"]', feedUrl);
    await clickText("Watch", '[role="dialog"] button');
    const watch = await poll(
      "RSS watch created through the browser UI",
      async () =>
        (await query("watches.list")).watches.find(
          (row) => row.handle === feedUrl,
        ),
    );
    watches.add(watch.id);
    assert.equal(watch.source, "web");
    assert.equal(watch.kind, "feed");
    assert.equal(watch.label, title);
    await waitFor("!document.querySelector('[aria-label=\"Link or handle\"]')");
    await settle(watch.id);
    const original = await poll(
      "RSS article completes the real host ingest",
      async () => {
        const rows = await rowsFor(articleUrl);
        return (
          rows.length === 1 &&
          rows[0].status === "complete" &&
          rows[0].files.length &&
          rows[0]
        );
      },
    );
    assert.equal(original.accountId, watch.id);
    assert.equal(original.source, "web");
    assert.equal(original.title, title);
    assert.ok((requests.get("/article/rss") ?? 0) > 0);
    await loadLibrary();
    await waitFor(`document.querySelector('[data-save-id="${original.id}"]')`);
    await prove("rss-ui-ingestion", "Chromium UI + host persistence reads");

    const previousHits = requests.get("/feed.xml") ?? 0;
    const previousSync = (await readWatch(watch.id)).sync.lastSyncedAt;
    assert.equal(
      (await run(`window.pond.syncRunNow(${JSON.stringify(watch.id)})`)).ok,
      true,
    );
    await poll("explicit backend repeat check finishes", async () => {
      const current = await readWatch(watch.id);
      return (
        (requests.get("/feed.xml") ?? 0) > previousHits &&
        current &&
        !current.syncing &&
        current.sync.lastSyncedAt !== previousSync
      );
    });
    assert.equal((await rowsFor(articleUrl)).length, 1);
    assert.equal((await readWatch(watch.id)).sync.lastError, null);
    await prove(
      "rss-repeat-deduplicates",
      "Authenticated browser command + host reads",
    );

    await click(`[data-save-id="${original.id}"] [role="option"]`, 2);
    await waitFor("document.querySelector('[data-save-details]')");
    await click('[aria-label="Save Actions"]');
    await text('[aria-label="Search save operations"]', "Move to Trash");
    await clickText("Move to Trash", '[role="menuitem"]');
    await poll(
      "owned RSS Save is trashed through the UI",
      async () =>
        (await query("saves.get", { id: original.id })).deletedAt != null,
    );
    await loadLibrary();
    await newAction("Import from Links");
    await text('[role="dialog"] textarea', articleUrl);
    await clickText("Import", '[role="dialog"] button');
    await waitFor("!document.querySelector('[role=dialog] textarea')");
    const restored = await poll(
      "re-saving the same URL restores its original ID",
      async () => {
        const row = await query("saves.get", { id: original.id });
        return row && row.deletedAt == null && row;
      },
    );
    assert.equal(restored.id, original.id);
    assert.equal(savedAt(restored), savedAt(original));
    assert.equal((await rowsFor(articleUrl)).length, 1);
    await loadLibrary();
    await waitFor(`document.querySelector('[data-save-id="${original.id}"]')`);
    await prove(
      "trash-resave-keeps-identity",
      "Chromium UI + host persistence reads",
    );

    const atom = await query("watches.add", {
      source: "web",
      handle: `${fixture}/atom.xml`,
    });
    assert.equal(atom.ok, true);
    watches.add(atom.watch.id);
    assert.equal(atom.watch.kind, "feed");
    assert.equal(atom.watch.label, atomTitle);
    await settle(atom.watch.id);
    const atomRows = await poll("Atom relative entry is ingested", async () => {
      const rows = await rowsFor(`${fixture}/article/atom`);
      return rows.length === 1 && rows[0].status === "complete" && rows;
    });
    assert.equal(atomRows[0].accountId, atom.watch.id);
    const count = (await query("watches.list")).watches.length;
    assert.equal(
      (
        await query("watches.add", {
          source: "web",
          handle: `${fixture}/atom.xml`,
        })
      ).reason,
      "already_watching",
    );
    assert.equal(
      (
        await query("watches.resolve", {
          source: "web",
          input: `${fixture}/not-a-feed`,
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await query("watches.add", {
          source: "web",
          handle: `${fixture}/not-a-feed`,
        })
      ).reason,
      "invalid",
    );
    assert.equal(
      (
        await query("watches.resolve", {
          source: "web",
          input: "file:///tmp/not-a-feed",
        })
      ).ok,
      false,
    );
    assert.equal((await query("watches.list")).watches.length, count);
    await prove(
      "atom-and-invalid-feed-http",
      "Authenticated HTTP query checks; not UI mutations",
    );

    const accountRows = (await query("accounts.list")).accounts;
    assert.ok(
      !accountRows.some((row) => row.source === "marked"),
      "Marked UI acceptance must not rely on an authenticated Source account.",
    );
    const accounts = accountRows.map((row) => row.id).sort();
    await loadLibrary();
    await newAction("Marked");
    await waitFor(
      "[...document.querySelectorAll('[role=dialog]')].some(node => node.innerText.includes('Marked') && (node.innerText.includes('Pair the Circé extension') || node.innerText.includes('The Circé extension is connecting Marked')))",
    );
    await prove(
      "marked-extension-connection-ui",
      "Chromium UI; live authentication not exercised",
    );
    await clickText("Cancel", '[role="dialog"] button');
    await waitFor("!document.querySelector('[role=dialog]')");
    assert.deepEqual(
      (await query("accounts.list")).accounts.map((row) => row.id).sort(),
      accounts,
    );
    result = {
      checks,
      rssSave: original.id,
      rssWatch: watch.id,
      atomWatch: atom.watch.id,
      requests: Object.fromEntries(requests),
      limitations: [
        "Marked live authentication/library sync is not exercised; its browser connection UI is.",
        "Atom, repeat-check and invalid-feed cases are backend bridge checks, not UI interaction claims.",
        "Fixture Saves remain in the disposable Library for the caller to remove with its profile.",
      ],
    };
  } catch (error) {
    await snapshot("upgrade220-sources-failure").catch(() => {});
    throw error;
  } finally {
    try {
      key("Escape");
      const current = realpathSync((await query("library.info")).path);
      assert.equal(current, library, "Do not clean up a different Library.");
      for (const id of watches) {
        await run(`window.pond.syncCancel(${JSON.stringify(id)})`);
        assert.equal((await query("watches.remove", { watchId: id })).ok, true);
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
  writeFileSync(
    join(evidence, "upgrade220-sources-results.json"),
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
  console.log("WEB_UPGRADE220_SOURCES_PASSED", JSON.stringify(checks));
};
