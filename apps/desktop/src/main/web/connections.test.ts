import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PairingCodeSchema } from "../../shared/web-connections-contracts";
import { libraryAccess } from "../core/library-access";
import { createWebSessions, type SavedWebSession } from "./auth";
import { createWebConnections } from "./connections";

const origin = "https://circe.test";
const scope = `${origin}\0library-a`;
const login = { remember: false, label: "Test browser" };

function fixture(
  persist: (rows: SavedWebSession[]) => Promise<void> = async () => {},
) {
  let now = 1000;
  let libraryId = "library-a";
  const sessions = createWebSessions("fixture-key", () => now, {
    restored: [],
    persist,
    warn: () => {},
  });
  const connections = createWebConnections({
    sessions,
    origin,
    libraryId: () => libraryId,
    now: () => now,
  });
  return {
    sessions,
    connections,
    setTime: (value: number) => {
      now = value;
    },
    switchLibrary: (value: string) => {
      libraryId = value;
    },
    owner: () =>
      sessions.issue(scope, { remember: true, label: "Owner browser" }),
    async ownerCode(cookie: string) {
      return PairingCodeSchema.parse(
        await connections.manage({ action: "create" }, scope, cookie),
      );
    },
  };
}

function requiredCookie(cookie: string | null) {
  if (!cookie) throw new Error("Expected a paired browser cookie");
  return cookie;
}
function requiredDeviceId(
  sessions: ReturnType<typeof createWebSessions>,
  cookie: string,
) {
  const id = sessions.deviceId(cookie);
  if (!id) throw new Error("Expected a connected browser device");
  return id;
}

describe("browser connections", () => {
  it("does not cancel another origin's pending code when revoking its device UUID from this origin", async () => {
    const test = fixture();
    const alternateScope = "https://alternate.test\0library-a";
    const alternate = test.sessions.issue(alternateScope, login);
    const grant = PairingCodeSchema.parse(
      await test.connections.manage(
        { action: "create" },
        alternateScope,
        alternate,
      ),
    );
    await test.connections.nativeRevoke(
      requiredDeviceId(test.sessions, alternate),
    );
    expect(test.sessions.valid(alternate, alternateScope)).toBe(true);
    expect(
      await test.connections.redeem(alternateScope, {
        ...login,
        code: grant.code,
      }),
    ).not.toBeNull();
    await test.sessions.close();
  });

  it("keeps a closed connection owner closed even if its session store is still open", async () => {
    const test = fixture();
    const cookie = test.owner();
    const code = await test.ownerCode(cookie);
    test.connections.close();
    expect(() => test.connections.nativeCreateCode()).toThrow("reopening");
    await expect(
      test.connections.manage({ action: "create" }, scope, cookie),
    ).rejects.toThrow("reopening");
    await expect(
      test.connections.redeem(scope, { ...login, code: code.code }),
    ).rejects.toThrow("reopening");
    await test.sessions.close();
  });
  it("does not authorize or reuse a grant when the paired session cannot be saved", async () => {
    let fail = true;
    let stored: SavedWebSession[] = [];
    const test = fixture(async (rows) => {
      if (fail) {
        fail = false;
        throw new Error("Disk unavailable");
      }
      stored = rows;
    });
    const grant = test.connections.nativeCreateCode();
    await expect(
      test.connections.redeem(scope, { ...login, code: grant.code }),
    ).rejects.toThrow("Disk unavailable");
    expect(test.sessions.list(scope)).toEqual([]);
    expect(
      await test.connections.redeem(scope, { ...login, code: grant.code }),
    ).toBeNull();
    await test.sessions.flush();
    expect(stored).toEqual([]);
    await test.sessions.close();
  });

  it("revokes the pending recipient if its owner disconnects during persistence", async () => {
    let blocked = false;
    let stored: SavedWebSession[] = [];
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const test = fixture(async (rows) => {
      if (blocked) {
        started.resolve();
        await release.promise;
      }
      stored = rows;
    });
    const owner = test.owner();
    await test.sessions.flush();
    const grant = await test.ownerCode(owner);
    blocked = true;
    const redeeming = test.connections.redeem(scope, {
      ...login,
      code: grant.code,
    });
    await started.promise;
    const revoking = test.connections.nativeRevoke(
      requiredDeviceId(test.sessions, owner),
    );
    release.resolve();
    await revoking;
    expect(await redeeming).toBeNull();
    expect(test.sessions.list(scope)).toEqual([]);
    expect(stored).toEqual([]);
    await test.sessions.close();
  });

  it("revokes the pending recipient if its owner expires during persistence", async () => {
    let blocked = false;
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const test = fixture(async () => {
      if (blocked) {
        started.resolve();
        await release.promise;
      }
    });
    const owner = test.sessions.issue(scope, login);
    await test.sessions.flush();
    test.setTime(12 * 60 * 60_000);
    const grant = await test.ownerCode(owner);
    blocked = true;
    const redeeming = test.connections.redeem(scope, {
      ...login,
      code: grant.code,
    });
    await started.promise;
    test.setTime(1000 + 12 * 60 * 60_000);
    release.resolve();
    expect(await redeeming).toBeNull();
    expect(test.sessions.list(scope)).toEqual([]);
    await test.sessions.close();
  });

  it("consumes a pairing grant before a blocked disk write, preventing simultaneous redemption", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const test = fixture(async () => {
      started.resolve();
      await release.promise;
    });
    const grant = test.connections.nativeCreateCode();
    const first = test.connections.redeem(scope, {
      ...login,
      code: grant.code,
    });
    await started.promise;
    const second = await test.connections.redeem(scope, {
      ...login,
      code: grant.code,
    });
    expect(second).toBeNull();
    let completed = false;
    void first.then(() => {
      completed = true;
    });
    expect(completed).toBe(false);
    release.resolve();
    const cookie = requiredCookie(await first);
    expect(test.sessions.valid(cookie, scope)).toBe(true);
    expect(test.connections.nativeList().devices).toHaveLength(1);
    await test.sessions.close();
  });

  it("rejects pairing after the issuing owner expires or is revoked", async () => {
    const test = fixture();
    const owner = test.sessions.issue(scope, login);
    test.setTime(12 * 60 * 60_000);
    const expiring = await test.ownerCode(owner);
    test.setTime(1000 + 12 * 60 * 60_000);
    expect(
      await test.connections.redeem(scope, { ...login, code: expiring.code }),
    ).toBeNull();

    const nextOwner = test.owner();
    const revoked = await test.ownerCode(nextOwner);
    await test.connections.nativeRevoke(
      requiredDeviceId(test.sessions, nextOwner),
    );
    expect(
      await test.connections.redeem(scope, { ...login, code: revoked.code }),
    ).toBeNull();
    await expect(
      test.connections.manage({ action: "create" }, scope, nextOwner),
    ).rejects.toThrow("no longer connected");
    await test.sessions.close();
  });

  it("cancels browser-issued grants on logout without affecting another owner", async () => {
    const test = fixture();
    const owner = test.owner();
    const grant = await test.ownerCode(owner);
    test.connections.revokeCookie(owner);
    test.sessions.revoke(owner);
    expect(
      await test.connections.redeem(scope, { ...login, code: grant.code }),
    ).toBeNull();
    const nextOwner = test.owner();
    const nextGrant = await test.ownerCode(nextOwner);
    expect(
      await test.connections.redeem(scope, { ...login, code: nextGrant.code }),
    ).not.toBeNull();
    await test.sessions.close();
  });

  it("keeps remembered access fixed at 90 days while normal access expires at 12 hours", async () => {
    const test = fixture();
    const normalGrant = test.connections.nativeCreateCode();
    const normal = requiredCookie(
      await test.connections.redeem(scope, {
        ...login,
        code: normalGrant.code,
      }),
    );
    const rememberedGrant = test.connections.nativeCreateCode();
    const remembered = requiredCookie(
      await test.connections.redeem(scope, {
        remember: true,
        label: "Personal laptop",
        code: rememberedGrant.code,
      }),
    );
    const devices = test.connections.nativeList().devices;
    expect(
      devices.find((device) => device.id === test.sessions.deviceId(normal)),
    ).toMatchObject({ remembered: false, expiresAt: 1000 + 12 * 60 * 60_000 });
    expect(
      devices.find(
        (device) => device.id === test.sessions.deviceId(remembered),
      ),
    ).toMatchObject({
      label: "Personal laptop",
      remembered: true,
      expiresAt: 1000 + 90 * 24 * 60 * 60_000,
    });
    test.setTime(1000 + 12 * 60 * 60_000);
    expect(test.sessions.valid(normal, scope)).toBe(false);
    expect(test.sessions.valid(remembered, scope)).toBe(true);
    test.setTime(1000 + 90 * 24 * 60 * 60_000 - 1);
    expect(test.sessions.valid(remembered, scope)).toBe(true);
    test.setTime(1000 + 90 * 24 * 60 * 60_000);
    expect(test.sessions.valid(remembered, scope)).toBe(false);
    await test.sessions.close();
  });

  it("isolates device lists and revocation by scope and notifies only the revoked browser", async () => {
    const test = fixture();
    const owner = test.owner();
    const target = test.sessions.issue(scope, login);
    const otherScope = `${origin}\0library-b`;
    const other = test.sessions.issue(otherScope, login);
    let revoked = 0;
    test.sessions.onRevoke(target, () => {
      revoked++;
    });
    const targetId = requiredDeviceId(test.sessions, target);
    expect(test.connections.nativeList().devices).toHaveLength(2);
    await test.connections.nativeRevoke(requiredDeviceId(test.sessions, other));
    expect(test.sessions.valid(other, otherScope)).toBe(true);
    await test.connections.manage(
      { action: "revoke", id: targetId },
      scope,
      owner,
    );
    expect(revoked).toBe(1);
    expect(test.sessions.valid(target, scope)).toBe(false);
    expect(test.sessions.valid(owner, scope)).toBe(true);
    expect(
      test.connections.nativeList().devices.map((device) => device.id),
    ).toEqual([test.sessions.deviceId(owner)]);
    await test.sessions.close();
  });

  it("retries durable revocation after a write failure so the browser stays revoked after restart", async () => {
    let stored: SavedWebSession[] = [];
    let fail = false;
    const test = fixture(async (rows) => {
      if (fail) throw new Error("Disk unavailable");
      stored = rows;
    });
    const target = test.owner();
    const id = requiredDeviceId(test.sessions, target);
    await test.sessions.flush();
    fail = true;
    await expect(test.connections.nativeRevoke(id)).rejects.toThrow(
      "Disk unavailable",
    );
    expect(test.sessions.valid(target, scope)).toBe(false);
    expect(stored).toHaveLength(1);
    fail = false;
    await test.connections.nativeRevoke(id);
    expect(stored).toEqual([]);
    const reopened = createWebSessions("fixture-key", () => 1000, {
      restored: stored,
      persist: async () => {},
      warn: () => {},
    });
    expect(reopened.valid(target, scope)).toBe(false);
    await Promise.all([test.sessions.close(), reopened.close()]);
  });

  it("restores legacy cookies and gives them stable device identities that can be revoked", async () => {
    let stored: SavedWebSession[] = [];
    const cookie = "legacy-cookie";
    const sessions = createWebSessions("fixture-key", () => 1000, {
      restored: [
        {
          idHash: createHash("sha256").update(cookie).digest("hex"),
          expiry: 5000,
          scope,
        },
      ],
      persist: async (rows) => {
        stored = rows;
      },
      warn: () => {},
    });
    const connections = createWebConnections({
      sessions,
      origin,
      libraryId: () => "library-a",
    });
    expect(sessions.valid(cookie, scope)).toBe(true);
    const deviceId = requiredDeviceId(sessions, cookie);
    expect(connections.nativeList().devices).toMatchObject([
      { id: deviceId, label: "Browser", remembered: false, expiresAt: 5000 },
    ]);
    await sessions.flush();
    const reopened = createWebSessions("fixture-key", () => 1000, {
      restored: stored,
      persist: async () => {},
      warn: () => {},
    });
    expect(reopened.deviceId(cookie)).toBe(deviceId);
    await connections.nativeRevoke(deviceId);
    expect(sessions.valid(cookie, scope)).toBe(false);
    await Promise.all([sessions.close(), reopened.close()]);
  });

  it("rejects management and an in-flight redemption when the Library changes", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const test = fixture(async () => {
      started.resolve();
      await release.promise;
    });
    const grant = test.connections.nativeCreateCode();
    const redeeming = test.connections.redeem(scope, {
      ...login,
      code: grant.code,
    });
    await started.promise;
    test.switchLibrary("library-b");
    release.resolve();
    expect(await redeeming).toBeNull();
    expect(test.sessions.list(scope)).toEqual([]);
    const owner = test.owner();
    await expect(
      test.connections.manage({ action: "create" }, scope, owner),
    ).rejects.toThrow("no longer connected");
    await test.sessions.close();
  });

  it("fails closed during a Library transition and after the host closes admission", async () => {
    const test = fixture();
    const grant = test.connections.nativeCreateCode();
    await libraryAccess.transition({
      prepare: async () => {},
      operation: async () => {
        expect(() => test.connections.nativeCreateCode()).toThrow("reopening");
        await expect(
          test.connections.redeem(scope, { ...login, code: grant.code }),
        ).rejects.toThrow("reopening");
      },
      keepClosed: () => false,
    });
    expect(libraryAccess.isOpen()).toBe(true);
    await test.sessions.close();
    expect(() => test.connections.nativeList()).toThrow("reopening");
    await expect(
      test.connections.redeem(scope, { ...login, code: grant.code }),
    ).rejects.toThrow("reopening");
  });
});
