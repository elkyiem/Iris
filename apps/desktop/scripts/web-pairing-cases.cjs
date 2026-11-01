const assert = require("node:assert/strict");
const { BrowserWindow, app } = require("electron");
const { realpathSync, writeFileSync } = require("node:fs");
const { basename, join, sep } = require("node:path");
const { randomUUID } = require("node:crypto");
const { setTimeout: pause } = require("node:timers/promises");

exports.verifyBrowserPairing = async function verifyBrowserPairing({
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
}) {
  const root = realpathSync(sandbox);
  assert.ok(
    root.includes("pairing"),
    "Use an explicitly disposable pairing profile.",
  );
  const initial = await query("library.info");
  assert.ok(realpathSync(initial.path).startsWith(`${root}${sep}`));
  const originalFolder = basename(initial.path).replace(/\.pond$/, "");
  const proofs = [];
  const child = new BrowserWindow({
    width: 390,
    height: 844,
    show: true,
    webPreferences: {
      partition: `circe-pairing-${randomUUID()}`,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  const childRun = (source) =>
    child.webContents.executeJavaScript(source, true);
  const childWait = async (source) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (await childRun(`Boolean(${source})`)) return;
      await pause(100);
    }
    throw new Error(`Pairing browser condition timed out: ${source}`);
  };
  const childClick = async (selector) => {
    app.focus({ steal: true });
    child.focus();
    child.webContents.focus();
    await childWait("document.hasFocus()");
    const point = await childRun(
      `new Promise((resolve,reject)=>{let previous='',stable=0;const started=Date.now();const check=()=>{const node=document.querySelector(${JSON.stringify(selector)});if(node){node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();const p={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};const position=JSON.stringify(p);stable=position===previous?stable+1:0;previous=position;if(r.width&&node.contains(document.elementFromPoint(p.x,p.y))&&stable>=3){resolve(p);return;}}if(Date.now()-started>10000){reject(new Error('Pairing control is covered: '+${JSON.stringify(selector)}));return;}requestAnimationFrame(check);};check();})`,
    );
    child.webContents.sendInputEvent({ type: "mouseMove", ...point });
    child.webContents.sendInputEvent({
      type: "mouseDown",
      button: "left",
      clickCount: 1,
      ...point,
    });
    child.webContents.sendInputEvent({
      type: "mouseUp",
      button: "left",
      clickCount: 1,
      ...point,
    });
  };
  const childSnapshot = async (name) => {
    app.focus({ steal: true });
    child.focus();
    child.webContents.focus();
    await childWait("document.hasFocus()");
    await childRun(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    );
    writeFileSync(
      join(evidence, `${name}.png`),
      (await child.webContents.capturePage()).toPNG(),
      { mode: 0o600 },
    );
    writeFileSync(
      join(evidence, `${name}.txt`),
      await childRun("document.body.innerText"),
      { mode: 0o600 },
    );
  };
  const typeCode = async (value) => {
    await childClick("#pairing-code");
    await childWait(
      "document.activeElement===document.querySelector('#pairing-code')",
    );
    let entered = "";
    for (const character of value) {
      await child.webContents.insertText(character);
      entered += character;
      await childWait(
        `[...document.querySelectorAll('input[type=text]:not([aria-hidden=true])')].map(input=>input.value).join('')===${JSON.stringify(entered)}`,
      );
    }
    await childWait(
      `[...document.querySelectorAll('input[type=text]:not([aria-hidden=true])')].map(input=>input.value).join('')===${JSON.stringify(value)}`,
    );
  };
  const childConnected = () =>
    childWait(
      "document.querySelector('[data-slot=window]') && !document.querySelector('[data-browser-connection]')",
    );
  const ownerList = () => run("window.pond.query('webConnections.list')");
  const instance = async () => {
    const response = await fetch(`${origin}/web/ready`, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    return (await response.json()).instance;
  };
  const waitReplacement = async (previous) => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try {
        if ((await instance()) !== previous) return;
      } catch {}
      await pause(150);
    }
    throw new Error("Pairing restart did not replace the host.");
  };
  let childId;
  let renamed = false;
  let failure;
  try {
    await win.loadURL(`${origin}/settings/library`);
    await waitFor(
      "[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Connect a device')",
    );
    await run(
      "[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Connect a device').setAttribute('data-pairing-create','')",
    );
    const baseline = await ownerList();
    await click("[data-pairing-create]");
    await waitFor(
      "document.querySelector('[role=dialog] [aria-label=\"Connection code\"]')?.value.replace(/\\s/g,'').length===6",
    );
    const code = await run(
      "document.querySelector('[role=dialog] [aria-label=\"Connection code\"]').value.replace(/\\s/g,'')",
    );
    await snapshot("pairing-owner-code");
    await child.loadURL(origin);
    await childWait("document.querySelector('#pairing-code')");
    const geometry = await childRun(
      "(()=>{const form=document.querySelector('[data-browser-connection]'),r=form.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};})()",
    );
    assert.ok(
      geometry.left >= 0 &&
        geometry.right <= geometry.width + 1 &&
        geometry.bottom <= geometry.height + 1,
    );
    await childSnapshot("pairing-phone-login");
    await typeCode(code === "000000" ? "000001" : "000000");
    await childClick('button[type="submit"]');
    await childWait(
      "document.querySelector('[role=alert]')?.textContent.includes('incorrect or expired')",
    );
    await childSnapshot("pairing-phone-invalid");
    await child.loadURL(origin);
    await childWait("document.querySelector('#pairing-code')");
    await typeCode(code);
    await childClick('button[type="submit"]');
    await childConnected();
    const connected = await childRun(
      "window.pond.query('webConnections.list')",
    );
    childId = connected.currentId;
    assert.ok(childId);
    assert.equal(
      connected.devices.find((device) => device.id === childId).remembered,
      true,
    );
    const cookies = await child.webContents.session.cookies.get({
      url: origin,
      name: "iris_session",
    });
    assert.equal(cookies.length, 1);
    assert.ok(cookies[0].expirationDate > Date.now() / 1000 + 89 * 24 * 3600);
    assert.equal(
      (await ownerList()).devices.length,
      baseline.devices.length + 1,
    );
    await childSnapshot("pairing-phone-connected");
    proofs.push(
      "A trusted browser creates a code; actual phone-width numeric input rejects a wrong code and remembers a successful connection for 90 days",
    );
    await click('[role="dialog"] button[aria-label="Close"]');
    await waitFor(
      "!document.querySelector('[role=dialog] [aria-label=\"Connection code\"]')",
    );
    await child.loadURL(origin);
    await childConnected();
    const previous = await instance();
    const result = await query("library.rename", {
      name: `Pairing restart ${Date.now()}`,
    });
    assert.equal(result.ok, true);
    renamed = true;
    await waitReplacement(previous);
    await child.loadURL(origin);
    await childConnected();
    assert.equal(
      (await childRun("window.pond.query('webConnections.list')")).currentId,
      childId,
    );
    await refreshSession();
    proofs.push(
      "The remembered browser keeps the same authorization after reload and a real supervised host replacement",
    );
    await child.loadURL(`${origin}/settings/library`);
    await childWait(
      "[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Connect a device')",
    );
    await childRun(
      "[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Connect a device').setAttribute('data-pairing-create','')",
    );
    await childClick("[data-pairing-create]");
    await childWait(
      "document.querySelector('[role=dialog] [aria-label=\"Connection code\"]')",
    );
    const unused = await childRun(
      "document.querySelector('[role=dialog] [aria-label=\"Connection code\"]').value.replace(/\\s/g,'')",
    );
    await win.loadURL(`${origin}/settings/library`);
    await waitFor(
      "window.pond && document.querySelector('[aria-label=\"Library Name\"]')",
    );
    const listing = await ownerList();
    const recipient = listing.devices.find((device) => device.id === childId);
    assert.ok(recipient);
    const disconnect = `button[data-connection-id=${JSON.stringify(childId)}]`;
    await waitFor(
      `document.querySelectorAll(${JSON.stringify(disconnect)}).length===1`,
    );
    await click(disconnect);
    await waitFor(
      "[...document.querySelectorAll('[role=alertdialog] button,[role=dialog] button')].some(button=>button.textContent.trim()==='Disconnect')",
    );
    await run(
      "[...document.querySelectorAll('[role=alertdialog] button,[role=dialog] button')].find(button=>button.textContent.trim()==='Disconnect').setAttribute('data-pairing-confirm','')",
    );
    await click("[data-pairing-confirm]");
    await waitFor(`!document.querySelector(${JSON.stringify(disconnect)})`);
    await child.loadURL(origin);
    await childWait("document.querySelector('#pairing-code')");
    await typeCode(unused);
    await childClick('button[type="submit"]');
    await childWait(
      "document.querySelector('[role=alert]')?.textContent.includes('incorrect or expired')",
    );
    await childSnapshot("pairing-phone-revoked");
    proofs.push(
      "A newly trusted browser can generate a code; actual Settings disconnect revokes its cookie and its outstanding code",
    );
  } catch (error) {
    failure = error;
    await childSnapshot("pairing-browser-failed").catch(() => {});
    await snapshot("pairing-owner-failed").catch(() => {});
  } finally {
    if (!child.isDestroyed()) child.destroy();
    try {
      await win.loadURL(`${origin}/settings/library`);
      await waitFor(
        "window.pond && document.querySelector('[aria-label=\"Library Name\"]')",
      );
      if (childId)
        await run(
          `window.pond.query('webConnections.revoke',{id:${JSON.stringify(childId)}})`,
        );
      if (renamed) {
        const previous = await instance();
        assert.equal(
          (await query("library.rename", { name: originalFolder })).ok,
          true,
        );
        await waitReplacement(previous);
        await win.loadURL(origin);
        await waitFor(
          "window.pond && document.querySelector('[data-slot=window]')",
        );
        await refreshSession();
      }
      assert.deepEqual(await query("library.info"), initial);
    } catch (error) {
      failure = failure
        ? new AggregateError(
            [failure, error],
            "Pairing acceptance and cleanup failed",
          )
        : error;
    }
  }
  if (failure) throw failure;
  writeFileSync(
    join(evidence, "pairing-results.json"),
    JSON.stringify(
      { proofs, physicalDevice: false, disposableProfile: true, cleanup: true },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log("WEB_PAIRING_BROWSER_PASSED", JSON.stringify(proofs));
};
