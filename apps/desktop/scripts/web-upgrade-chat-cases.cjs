const assert = require("node:assert/strict");
const { realpathSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { join, sep } = require("node:path");

exports.verifyUpgradeChat = async function verifyUpgradeChat({
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
  const sandboxRoot = realpathSync(sandbox);
  assert.ok(sandboxRoot.includes("upgrade-220"));
  assert.ok(
    realpathSync((await query("library.info")).path).startsWith(
      `${sandboxRoot}${sep}`,
    ),
  );
  const proofs = [];
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let releaseMiddle;
  let releaseEnd;
  const middle = new Promise((resolve) => {
    releaseMiddle = resolve;
  });
  const end = new Promise((resolve) => {
    releaseEnd = resolve;
  });
  let streamingRequests = 0;
  const fixtureRequests = [];
  let requestText = "";
  const paragraphs = Array.from(
    { length: 28 },
    (_, index) =>
      `\n\nParagraph ${index + 1}: This offline reply exercises the real browser stream, shared conversation layout, and scroll following. **The words arrive incrementally** and remain readable while the response grows. This paragraph supplies enough text for a genuinely scrollable conversation, so trusted wheel input can release automatic following before more response chunks arrive.`,
  );
  const chunks = [
    "## Streaming browser fixture\n\n",
    ...paragraphs,
    "\n\n```js\nconst browser = 'Circé';\n```\n\n| Feature | Result |\n| --- | --- |\n| Streaming | Complete |\n\n[Unsafe](javascript:alert(1))\n\n<img src=\"https://example.invalid/private.png\"/>\n\nFixture response complete.",
  ];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://fixture.invalid");
      const observed = { method: request.method, path: url.pathname };
      fixtureRequests.push(observed);
      if (url.pathname.endsWith("/models")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [
              {
                id: "circe-fixture",
                object: "model",
                capabilities: { text: true, tools: true },
              },
            ],
          }),
        );
        return;
      }
      if (url.pathname === "/api/show") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            capabilities: ["completion", "tools"],
            model_info: {
              "general.architecture": "llama",
              "llama.context_length": 32768,
            },
          }),
        );
        return;
      }
      if (!url.pathname.endsWith("/chat/completions")) {
        response.writeHead(404);
        response.end();
        return;
      }
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1024 * 1024)
          throw new Error("Fixture request exceeds its budget");
      }
      const input = JSON.parse(body);
      observed.stream = input.stream ?? false;
      observed.model = input.model;
      if (!input.stream) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "warmup",
            object: "chat.completion",
            created: 1,
            model: "circe-fixture",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "OK" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
        return;
      }
      const turn = streamingRequests++;
      if (turn === 1) await middle;
      if (turn === 2) await end;
      if (turn > 2) throw new Error("Unexpected extra provider turn");
      requestText = JSON.stringify(input.messages);
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
      });
      response.flushHeaders();
      const send = (delta, finish_reason = null) => {
        response.write(
          `data: ${JSON.stringify({ id: "offline-upgrade", object: "chat.completion.chunk", created: 1, model: "circe-fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      };
      send({ role: "assistant" });
      const start = turn === 0 ? 0 : turn === 1 ? 13 : 21;
      const stop = turn === 0 ? 13 : turn === 1 ? 21 : chunks.length;
      for (const content of chunks.slice(start, stop)) {
        if (response.destroyed) break;
        send({ content });
        await pause(35);
      }
      if (!response.destroyed) {
        if (turn < 2)
          send({
            tool_calls: [
              {
                index: 0,
                id: `fixture-search-${turn}`,
                type: "function",
                function: {
                  name: "searchLibrary",
                  arguments: JSON.stringify({
                    query: "circe-no-matches-fixture",
                    limit: 1,
                  }),
                },
              },
            ],
          });
        send({}, turn < 2 ? "tool_calls" : "stop");
        response.end("data: [DONE]\n\n");
      }
    } catch (error) {
      if (!response.headersSent) response.writeHead(500);
      response.end(error.message);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const debuggerApi = win.webContents.debugger;
  const rawClick = async (selector) => {
    const point = await run(
      `(() => {const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw new Error('Missing control');const r=node.getBoundingClientRect();const p={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};if(!node.contains(document.elementFromPoint(p.x,p.y)))throw new Error('Control is covered');return p;})()`,
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
  };
  try {
    // Only the provider is a fixture. HTTP admission, AI SDK streaming, persistence and UI stay real.
    await query("settings.setPrefs", {
      agent: {
        languageModel: "ollama",
        ollamaBaseUrl: `${base}/v1`,
        ollamaModelId: "circe-fixture",
        modelIds: { ollama: "circe-fixture" },
      },
    });
    const connection = await query("agent.saveKey", {
      provider: "ollama",
      key: "",
    });
    assert.equal(connection.ok, true, connection.error);
    const targetFish = await query("fish.create", {
      name: `Stream Fixture ${Date.now().toString(36)}`,
      model: { provider: "ollama", modelId: "circe-fixture" },
    });
    win.setSize(1280, 900);
    await win.loadURL(`${origin}/?q=`);
    await waitFor("document.querySelector('[aria-label=\"Toggle Sidebar\"]')");
    if (
      !(await run(
        "Boolean(document.querySelector('[data-slot=window][data-left-open]'))",
      ))
    )
      await click('[aria-label="Toggle Sidebar"]');
    const fishSelector = `button[aria-label="${targetFish.name}"]`;
    await waitFor(`document.querySelector(${JSON.stringify(fishSelector)})`);
    await click(fishSelector);
    await waitFor(
      "document.querySelector('[aria-label=Message][contenteditable=true]')",
    );
    await click('[aria-label="Message"][contenteditable=true]');
    await win.webContents.insertText(
      "Show the offline browser streaming fixture.",
    );
    await click('[aria-label="Send"]');
    await waitFor(
      "document.querySelector('[data-role=assistant]')?.innerText.includes('Paragraph 12') && document.querySelector('[aria-label=Stop]')",
    );
    assert.ok(streamingRequests >= 1 && streamingRequests <= 2);
    assert.ok(
      requestText.includes("Show the offline browser streaming fixture."),
    );
    await waitFor("document.querySelector('[data-role=assistant] strong')");
    await waitFor(
      "document.querySelector('[data-role=assistant] [data-sd-animate]')",
    );
    const firstWord = await run(
      "(() => {const word=document.querySelector('[data-role=assistant] [data-sd-animate]');word.setAttribute('data-upgrade-first-word','');return word.textContent;})()",
    );
    await run(
      "document.querySelector('[data-role=assistant]').closest('[data-scroll-fade=vertical]').setAttribute('data-upgrade-scroll','')",
    );
    await waitFor(
      "(() => {const e=document.querySelector('[data-upgrade-scroll]');return e.scrollHeight>e.clientHeight+300 && e.scrollHeight-e.scrollTop-e.clientHeight<5 && !document.querySelector('[aria-label=\"Read Latest Response\"]');})()",
    );
    const followingTop = await run(
      "document.querySelector('[data-upgrade-scroll]').scrollTop",
    );
    proofs.push(
      "Validated reply chunks pass through authenticated host HTTP and render as streaming Markdown",
    );
    const point = await run(
      "(() => {const viewport=document.querySelector('[data-upgrade-scroll]');const r=viewport.getBoundingClientRect();for(const fraction of [.3,.5,.7]){const x=Math.round(r.x+r.width*fraction),y=Math.round(r.y+r.height*.45);if(document.elementFromPoint(x,y)?.closest('[data-upgrade-scroll]')===viewport)return {x,y};}throw new Error('Conversation viewport has no unobstructed wheel target');})()",
    );
    win.focus();
    debuggerApi.attach("1.3");
    await debuggerApi.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...point,
    });
    await debuggerApi.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      ...point,
      deltaX: 0,
      deltaY: -700,
    });
    await waitFor(
      `(() => {const e=document.querySelector('[data-upgrade-scroll]');return document.querySelector('[aria-label="Read Latest Response"]') && e.scrollTop<${followingTop - 100} && e.scrollHeight-e.scrollTop-e.clientHeight>100;})()`,
    );
    const releasedTop = await run(
      "document.querySelector('[data-upgrade-scroll]').scrollTop",
    );
    releaseMiddle();
    await waitFor(
      "document.querySelector('[data-role=assistant]')?.innerText.includes('Paragraph 20')",
    );
    await pause(350);
    const held = await run(
      "(() => {const e=document.querySelector('[data-upgrade-scroll]');return {top:e.scrollTop,gap:e.scrollHeight-e.scrollTop-e.clientHeight};})()",
    );
    assert.equal(
      await run(
        "document.querySelector('[data-upgrade-first-word]')?.textContent",
      ),
      firstWord,
      "Appending stream chunks must retain already rendered words",
    );
    assert.ok(
      held.top <= releasedTop + 24 && held.gap > 100,
      "New chunks must not pull a user who scrolled up back to the bottom",
    );
    proofs.push(
      "Trusted wheel input releases following while more chunks arrive",
    );
    await rawClick('[aria-label="Read Latest Response"]');
    await waitFor(
      "(() => {const e=document.querySelector('[data-upgrade-scroll]');return e.scrollHeight-e.scrollTop-e.clientHeight<80;})()",
    );
    releaseEnd();
    await waitFor(
      "document.querySelector('[data-role=assistant]')?.innerText.includes('Fixture response complete.') && !document.querySelector('[aria-label=Stop]')",
    );
    await waitFor(
      "document.querySelector('[data-role=assistant] table') && document.querySelector('[data-role=assistant] pre code')",
    );
    await waitFor(
      "(() => {const e=document.querySelector('[data-upgrade-scroll]');return e.scrollHeight-e.scrollTop-e.clientHeight<5;})()",
    );
    assert.equal(
      await run(
        "Boolean(document.querySelector('[data-role=assistant] a[href^=\"javascript:\"], [data-role=assistant] img'))",
      ),
      false,
    );
    const layout = await run(
      "(() => {const message=document.querySelector('[data-role=assistant]');return {reply:message.getBoundingClientRect().width,viewport:message.closest('[data-scroll-fade=vertical]').clientWidth};})()",
    );
    assert.ok(
      layout.reply >= layout.viewport * 0.75,
      "Fish replies use the available conversation width",
    );
    proofs.push(
      "Read Latest Response restores following; full-width reply renders code/table and blocks unsafe HTML/URLs",
    );
    await snapshot("upgrade220-chat-desktop");
    debuggerApi.detach();
    const chats = await query("agent.chats", { fishId: targetFish.id });
    assert.equal(streamingRequests, 3);
    const list = Array.isArray(chats) ? chats : chats.chats;
    let persisted;
    for (const chat of list) {
      const messages = await query("agent.messages", { chatId: chat.id });
      if (
        messages.some(
          (message) =>
            message.role === "assistant" &&
            message.content.includes("Fixture response complete."),
        )
      ) {
        persisted = chat;
        break;
      }
    }
    assert.ok(
      persisted,
      "The streamed reply must be persisted by the actual host",
    );
    await win.loadURL(win.webContents.getURL());
    await waitFor(
      "document.querySelector('[data-role=assistant]')?.innerText.includes('Fixture response complete.')",
    );
    win.setSize(390, 844);
    await waitFor("innerWidth===390");
    if (
      await run(
        "Boolean(document.querySelector('[data-slot=window][data-left-open]'))",
      )
    )
      await click('[aria-label="Toggle Sidebar"]');
    if (
      await run(
        "Boolean(document.querySelector('[data-slot=window][data-right-open]'))",
      )
    )
      await click('[aria-label="Toggle Details"]');
    await waitFor("document.querySelector('[data-role=assistant] table')");
    await waitFor(
      "document.querySelector('[data-role=assistant]').closest('[data-scroll-fade=vertical]').clientWidth>innerWidth*.8",
    );
    if (
      await run(
        "Boolean(document.querySelector('[aria-label=\"Read Latest Response\"]'))",
      )
    )
      await rawClick('[aria-label="Read Latest Response"]');
    await waitFor(
      "(() => {const table=document.querySelector('[data-role=assistant] table');const r=table.getBoundingClientRect();return r.width>0 && r.top>=0 && r.bottom<=innerHeight && table.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()",
    );
    await snapshot("upgrade220-chat-phone");
    proofs.push(
      "Persisted formatted reply survives reload and phone-width layout",
    );
    win.setSize(1280, 900);
    await run(
      "localStorage.setItem('pond:firstVersion','0.0.0');localStorage.removeItem('pond:prompted:github')",
    );
    await win.loadURL(`${origin}/?q=`);
    await waitFor(
      "[...document.querySelectorAll('[data-slot=toasts] button')].some(button=>button.textContent.trim()==='Not Now')",
      35000,
    );
    await run(
      "[...document.querySelectorAll('[data-slot=toasts] button')].find(button=>button.textContent.trim()==='Not Now').setAttribute('data-upgrade-not-now','')",
    );
    assert.equal(
      await run(
        "[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].some(node=>node.getBoundingClientRect().width && !node.closest('[data-slot=toasts]'))",
      ),
      false,
      "The automatic ask stays in the toast viewport without opening a modal",
    );
    await snapshot("upgrade220-startup-toast");
    await rawClick("[data-upgrade-not-now]");
    await waitFor(
      "![...document.querySelectorAll('[data-slot=toasts] button')].some(button=>button.textContent.trim()==='Not Now')",
    );
    assert.ok(await run("localStorage.getItem('pond:prompted:github')"));
    proofs.push(
      "Real 20-second startup ask appears as a toast and its visible Not Now control dismisses it",
    );
    writeFileSync(
      join(evidence, "upgrade220-chat-results.json"),
      JSON.stringify({ proofs, streamingRequests, fixtureOnly: true }, null, 2),
      { mode: 0o600 },
    );
    console.log("UPGRADE_220_CHAT_PASSED", JSON.stringify(proofs));
  } finally {
    writeFileSync(
      join(evidence, "upgrade220-chat-fixture-requests.json"),
      JSON.stringify(fixtureRequests, null, 2),
      { mode: 0o600 },
    );
    releaseMiddle();
    releaseEnd();
    if (debuggerApi.isAttached()) debuggerApi.detach();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
};
