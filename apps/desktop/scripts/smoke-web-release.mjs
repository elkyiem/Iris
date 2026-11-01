import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import JSZip from "jszip";
import sharp from "sharp";
import { connectWebHost } from "./web-smoke-client.mjs";

/** Local acceptance only: never run imports against the owner's normal profile. */
const sandbox = await realpath(resolve(process.env.POND_SANDBOX ?? "."));
const localAcceptance =
  /\/\.artifacts\/web-verification\/(?:added-commits-\d{8}\/sandbox(?:-[a-z0-9-]+)?|pond-220-\d{8}\/upgrade-220)$/.test(
    sandbox.split(sep).join("/"),
  );
const isolatedCi =
  dirname(sandbox) === (await realpath(tmpdir())) &&
  /^iris-web-ci-[a-z0-9-]+$/i.test(basename(sandbox));
assert.ok(
  localAcceptance || isolatedCi,
  "Use the explicitly disposable added-commits verification profile.",
);
const host = await connectWebHost();
const nonce = randomUUID();
const prefix = `Release acceptance ${nonce}`;
const ownedIds = new Set();
const folderIds = new Set();
const origins = [];
let originalPause;
let library;
let failure;
const result = {};

const owned = (save) =>
  ownedIds.has(save.id) ||
  save.title?.startsWith(prefix) ||
  save.url?.includes(nonce) ||
  save.sourceId?.includes(nonce);
const rows = async () =>
  (await host.query("saves.list", { limit: 10000 })).filter(owned);
const remember = async () => {
  const saves = await rows();
  for (const save of saves) ownedIds.add(save.id);
  return saves;
};
const upload = async (name, bytes) => {
  const response = await host.request("upload", undefined, {
    method: "PUT",
    headers: {
      ...host.headers,
      "content-type": "application/octet-stream",
      "x-iris-filename": encodeURIComponent(name),
    },
    body: bytes,
  });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).token;
};
const importFile = async (name, filename, bytes, params = {}) => {
  const token = await upload(filename, bytes);
  const imported = await host.call("files", {
    name,
    params: { paths: [token], ...params },
  });
  assert.equal(imported.ok, true, JSON.stringify(imported));
  await remember();
  return imported;
};
const archive = async (files) => {
  const zip = new JSZip();
  for (const [name, bytes] of Object.entries(files)) zip.file(name, bytes);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
};
const lookup = async (predicate) => {
  const selected = (await remember()).filter(predicate);
  assert.equal(selected.length, 1, "The nonce must identify exactly one Save.");
  return selected[0];
};
const readOrigin = async (save, origin) => {
  const detail = await host.query("saves.get", { id: save.id });
  assert.equal(detail.importedFrom, origin);
  const metadata = JSON.parse(
    await readFile(
      join(library.path, "items", `${save.id}.info`, "info.json"),
      "utf8",
    ),
  );
  assert.equal(metadata.importedFrom, origin);
  const filtered = await host.query("saves.query", {
    deletedOnly: false,
    query: {
      combinator: "and",
      rules: [
        { field: "importedFrom", operator: "eq", value: origin },
        {
          combinator: "or",
          rules: [
            { field: "title", operator: "startsWith", value: prefix },
            { field: "url", operator: "contains", value: nonce },
          ],
        },
      ],
    },
    limit: 1000,
  });
  assert.ok(filtered.ids.includes(save.id));
  assert.ok(
    (await host.query("saves.getMany", { ids: filtered.ids })).every(
      (row) => row.importedFrom === origin,
    ),
  );
  if (detail.status === "complete") {
    const page = await host.query("saves.queryPage", {
      query: {
        combinator: "and",
        rules: [{ field: "importedFrom", operator: "eq", value: origin }],
      },
      scope: { saveIds: [save.id] },
    });
    assert.deepEqual(page.ids, [save.id]);
  }
  origins.push(origin);
};
try {
  library = await host.query("library.info");
  assert.ok(
    (await realpath(library.path)).startsWith(`${sandbox}${sep}`),
    "The authenticated host must use the disposable Library.",
  );
  originalPause = (await host.query("pipeline.status")).paused;
  await host.call("command", { name: "pipelinePause", paused: true });

  const files = await importFile(
    "saves.importFiles",
    `${prefix} files.txt`,
    Buffer.from(`${prefix}\nImported file content.`),
  );
  assert.equal(files.ids.length, 1);
  await readOrigin(
    await host.query("saves.get", { id: files.ids[0] }),
    "files",
  );

  const png = await sharp(randomBytes(17 * 13 * 3), {
    raw: { width: 17, height: 13, channels: 3 },
  })
    .png()
    .toBuffer();
  const pasted = await importFile(
    "saves.importFiles",
    `${prefix} clipboard.png`,
    png,
    {
      origin: "clipboard",
    },
  );
  assert.equal(pasted.ids.length, 1);
  await readOrigin(
    await host.query("saves.get", { id: pasted.ids[0] }),
    "clipboard",
  );

  const stamp = "2024-01-02T03:04:05.000Z";
  const packageSaves = Array.from({ length: 13 }, (_, index) => ({
    id: `${nonce}-${index}`,
    title: `${prefix} package ${index}`,
    source: "local",
    sourceId: `release:${nonce}:${index}`,
    url: `pond:local/${nonce}/${index}`,
    notes: `${prefix} package note ${index}`,
    tags: [],
    files: [],
    folderIds: [nonce],
    savedAt: stamp,
    createdAt: stamp,
  }));
  await importFile(
    "saves.importPackage",
    `${prefix}.pondpack.zip`,
    await archive({
      "pond-export.json": JSON.stringify({
        version: 1,
        saves: packageSaves,
        folders: [{ id: nonce, name: `${prefix} Pages`, parentId: null }],
        exportedFiles: [],
      }),
    }),
  );
  const packages = (await remember()).filter((save) =>
    save.sourceId.startsWith(`release:${nonce}:`),
  );
  assert.equal(packages.length, 13);
  await readOrigin(packages[0], "pond-package");
  const folder = (await host.query("folders.list")).find(
    (row) => row.name === `${prefix} Pages`,
  );
  assert.ok(folder);
  folderIds.add(folder.id);

  const bookmarkUrl = `http://127.0.0.1:1/${nonce}/bookmark`;
  await importFile(
    "saves.importBookmarks",
    `${prefix}.html`,
    Buffer.from(
      `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><A HREF="${bookmarkUrl}">Owned link</A></DL>`,
    ),
  );
  await readOrigin(
    await lookup((save) => save.url === bookmarkUrl),
    "bookmarks",
  );

  const dataUrl = `http://127.0.0.1:1/${nonce}/data-export`;
  await importFile(
    "saves.importDataExport",
    `${prefix} data.zip`,
    await archive({
      "saved_posts.csv": `id,permalink\nowned,${dataUrl}\n`,
    }),
  );
  await readOrigin(await lookup((save) => save.url === dataUrl), "data-export");

  await importFile(
    "saves.importMymind",
    `${prefix} mymind.zip`,
    await archive({
      "cards.csv": `id,type,title,url,content,note,tags,created\n${nonce},Note,${prefix} mymind,,Owned offline note,,,2024-01-02T03:04:05Z\n`,
    }),
  );
  await readOrigin(
    await lookup((save) => save.sourceId === `mymind:${nonce}`),
    "mymind",
  );

  const eagle = {
    id: nonce,
    name: `${prefix} Eagle`,
    ext: "txt",
    tags: [],
    folders: [],
    url: "",
  };
  await importFile(
    "saves.importEaglePackage",
    `${prefix}.eaglepack`,
    await archive({
      "pack.json": JSON.stringify({ images: [eagle] }),
      [`${nonce}.info/metadata.json`]: JSON.stringify(eagle),
      [`${nonce}.info/${nonce}.txt`]: `${prefix} Eagle content`,
    }),
  );
  await readOrigin(
    await lookup((save) => save.sourceId === `eagle:${nonce}`),
    "eagle",
  );

  const ids = packages.map((save) => save.id);
  const before = await host.query("saves.getMany", { ids });
  const edited = await host.request("query", {
    name: "saves.bulkEdit",
    params: { ids, operation: { kind: "notes", notes: `${prefix} bulk edit` } },
  });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).changed, ids.length);
  assert.ok(
    (await host.query("saves.getMany", { ids })).every(
      (save) => save.notes === `${prefix} bulk edit`,
    ),
  );
  await host.call("history", {
    kind: "undo",
    revision: Number(edited.headers.get("x-iris-history")),
  });
  assert.deepEqual(
    (await host.query("saves.getMany", { ids }))
      .map((save) => [save.id, save.notes])
      .sort(),
    before.map((save) => [save.id, save.notes]).sort(),
  );

  const scope = { folderIds: [folder.id] };
  const expected = ids.toSorted().reverse();
  const first = await host.query("saves.queryPage", {
    scope,
    sortKey: "savedAt",
    sortDir: "desc",
    limit: 3,
  });
  assert.equal(first.total, ids.length);
  assert.deepEqual(first.ids, expected.slice(0, 3));
  const later = await host.call("files", {
    name: "saves.createManual",
    params: {
      title: `${prefix} later`,
      note: "A newer owned Save inserted between pages.",
    },
  });
  assert.equal(later.ok, true);
  ownedIds.add(later.id);
  assert.equal(
    (
      await host.query("folders.addSaves", {
        folderId: folder.id,
        saveIds: [later.id],
      })
    ).ok,
    true,
  );
  const paged = [...first.ids];
  let cursor = first.nextCursor;
  while (cursor) {
    const next = await host.query("saves.queryPage", {
      scope,
      sortKey: "savedAt",
      sortDir: "desc",
      limit: 3,
      cursor,
    });
    assert.equal(next.total, ids.length + 1);
    paged.push(...next.ids);
    cursor = next.nextCursor;
    assert.ok(
      paged.length <= ids.length,
      "A cursor must advance without repeating rows.",
    );
  }
  assert.deepEqual(paged, expected);
  assert.equal(new Set(paged).size, ids.length);
  assert.deepEqual(
    (
      await host.query("saves.queryIds", {
        scope,
        sortKey: "savedAt",
        sortDir: "asc",
      })
    ).ids,
    [...expected, later.id],
  );
  result.bulkEditUndo = ids.length;
  result.stablePagination = {
    tiedRows: ids.length,
    insertionBetweenPages: true,
    ascendingAndDescending: true,
  };

  assert.deepEqual(
    await host.call("inference", { op: "embedTexts", texts: [] }),
    [],
  );
  await pause(17000);
  assert.deepEqual(
    await host.call("inference", { op: "embedTexts", texts: [] }),
    [],
  );
  const enrichment = await host.query("enrichment.status");
  assert.notEqual(enrichment.state, "failed", enrichment.error);
  assert.notEqual(enrichment.state, "starting");
  result.enrichment = {
    emptyCallsAcrossIdleWindow: 2,
    state: enrichment.state,
    modelDownloads: false,
  };
  result.importOrigins = origins;
  result.scopeToggle =
    "Not exercised: no credential-free Account seed endpoint; covered by focused handler/component tests.";
} catch (error) {
  failure = error;
} finally {
  try {
    if (originalPause !== undefined) {
      const saves = await remember();
      if (saves.length) {
        await host.call("command", {
          name: "pipelineCancelSaves",
          ids: saves.map((save) => save.id),
        });
        await host.query("saves.bulkEdit", {
          ids: saves.map((save) => save.id),
          operation: { kind: "purge" },
        });
      }
      for (const folder of await host.query("folders.list")) {
        if (folder.name === `${prefix} Pages`) folderIds.add(folder.id);
      }
      for (const id of folderIds) await host.query("folders.delete", { id });
      assert.equal(
        (await rows()).length,
        0,
        "All nonce-owned Saves must be retired.",
      );
    }
  } catch (cleanup) {
    failure = failure
      ? new AggregateError(
          [failure, cleanup],
          "Release check and cleanup failed",
        )
      : cleanup;
  } finally {
    try {
      if (originalPause !== undefined)
        await host.call("command", {
          name: "pipelinePause",
          paused: originalPause,
        });
    } finally {
      const logout = await host.request("session", undefined, {
        method: "DELETE",
      });
      assert.equal(logout.status, 200);
      assert.equal((await host.request("session")).status, 401);
    }
  }
}
if (failure) throw failure;
await writeFile(
  join(sandbox, `release-verification-${nonce}.json`),
  JSON.stringify({ ...result, cleaned: true }, null, 2),
  { mode: 0o600 },
);
console.log(
  "WEB_RELEASE_HTTP_PASSED",
  JSON.stringify({ ...result, cleaned: true }),
);
