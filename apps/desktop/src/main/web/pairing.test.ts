import { describe, expect, it } from "vitest";
import { createBrowserPairing } from "./pairing";

const scope = "https://circe.test\0library-a";

describe("browser pairing grants", () => {
  it("preserves leading zeroes when displaying and redeeming a code", () => {
    const pairing = createBrowserPairing(
      () => 1000,
      () => 42,
    );
    const grant = pairing.create(scope, "owner", "https://circe.test");
    expect(grant.code).toBe("000042");
    expect(pairing.redeem(scope, "42")).toBeNull();
    expect(pairing.redeem(scope, grant.code)).toBe("owner");
  });

  it("makes a replacement code unusable through the previous grant", () => {
    let nextCode = 123456;
    const pairing = createBrowserPairing(
      () => 1000,
      () => nextCode++,
    );
    const old = pairing.create(scope, "owner", "https://circe.test");
    const current = pairing.create(scope, "owner", "https://circe.test");
    expect(pairing.redeem(scope, old.code)).toBeNull();
    expect(pairing.redeem(scope, current.code)).toBe("owner");
  });

  it("issues a six-digit code bound to its Library and origin, then consumes it once", () => {
    const pairing = createBrowserPairing(() => 1000);
    const grant = pairing.create(scope, "owner", "https://circe.test");
    expect(grant.code).toMatch(/^\d{6}$/);
    expect(grant.expiresAt).toBe(121000);
    expect(grant.origin).toBe("https://circe.test");
    expect(
      pairing.redeem("https://other.test\0library-a", grant.code),
    ).toBeNull();
    expect(
      pairing.redeem("https://circe.test\0library-b", grant.code),
    ).toBeNull();
    expect(pairing.redeem(scope, grant.code)).toBe("owner");
    expect(pairing.redeem(scope, grant.code)).toBeNull();
  });

  it("accepts a code just before two minutes and rejects it at the exact deadline", () => {
    let now = 1000;
    const pairing = createBrowserPairing(() => now);
    const first = pairing.create(scope, "owner", "https://circe.test");
    now = first.expiresAt - 1;
    expect(pairing.redeem(scope, first.code)).toBe("owner");
    const second = pairing.create(scope, "owner", "https://circe.test");
    now = second.expiresAt;
    expect(pairing.redeem(scope, second.code)).toBeNull();
  });

  it("shares the five-attempt budget between all callers, allowing a correct fifth attempt", () => {
    const pairing = createBrowserPairing();
    const grant = pairing.create(scope, "owner", "https://circe.test");
    const wrong = grant.code === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 4; attempt++)
      expect(pairing.redeem(scope, wrong)).toBeNull();
    expect(pairing.redeem(scope, grant.code)).toBe("owner");

    const exhausted = pairing.create(scope, "owner", "https://circe.test");
    const anotherWrong = exhausted.code === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 5; attempt++)
      expect(pairing.redeem(scope, anotherWrong)).toBeNull();
    expect(pairing.redeem(scope, exhausted.code)).toBeNull();
  });

  it("replaces the previous owner's grant and only lets its issuer cancel the current grant", () => {
    const pairing = createBrowserPairing();
    const old = pairing.create(scope, "first-owner", "https://circe.test");
    const current = pairing.create(scope, "second-owner", "https://circe.test");
    expect(pairing.cancel(scope, "first-owner", old.id)).toBe(false);
    expect(pairing.cancel(scope, "first-owner", current.id)).toBe(false);
    pairing.revokeIssuer("first-owner");
    expect(pairing.redeem(scope, current.code)).toBe("second-owner");
    const canceled = pairing.create(
      scope,
      "second-owner",
      "https://circe.test",
    );
    expect(pairing.cancel(scope, "second-owner", canceled.id)).toBe(true);
    expect(pairing.redeem(scope, canceled.code)).toBeNull();
  });

  it("revokes all grants from a disconnected owner while preserving another owner's grant", () => {
    const pairing = createBrowserPairing();
    const first = pairing.create(scope, "owner", "https://circe.test");
    const otherScope = "https://other.test\0library-a";
    const second = pairing.create(otherScope, "owner", "https://other.test");
    const independentScope = "https://circe.test\0library-b";
    const independent = pairing.create(
      independentScope,
      "other-owner",
      "https://circe.test",
    );
    pairing.revokeIssuer("owner");
    expect(pairing.redeem(scope, first.code)).toBeNull();
    expect(pairing.redeem(otherScope, second.code)).toBeNull();
    expect(pairing.redeem(independentScope, independent.code)).toBe(
      "other-owner",
    );
    const closing = pairing.create(scope, "owner", "https://circe.test");
    pairing.close();
    expect(pairing.redeem(scope, closing.code)).toBeNull();
  });
});
