import {
  createHash,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

const LIFETIME_MS = 2 * 60_000;
const MAX_ATTEMPTS = 5;
const digest = (code: string) => createHash("sha256").update(code).digest();

/** Explicit, ephemeral owner grants. Redemption consumes a grant synchronously. */
export function createBrowserPairing(
  now: () => number = Date.now,
  drawCode: () => number = () => randomInt(1_000_000),
) {
  const challenges = new Map<
    string,
    {
      id: string;
      digest: Buffer;
      expiresAt: number;
      attempts: number;
      issuer: string;
    }
  >();
  return {
    create(scope: string, issuer: string, origin: string) {
      for (const [key, value] of challenges)
        if (value.expiresAt <= now()) challenges.delete(key);
      const value = drawCode();
      if (!Number.isInteger(value) || value < 0 || value >= 1_000_000)
        throw new Error("Invalid pairing code source.");
      const code = value.toString().padStart(6, "0");
      const challenge = {
        id: randomUUID(),
        digest: digest(code),
        expiresAt: now() + LIFETIME_MS,
        attempts: 0,
        issuer,
      };
      challenges.set(scope, challenge);
      return { id: challenge.id, code, expiresAt: challenge.expiresAt, origin };
    },
    redeem(scope: string, code: string) {
      const challenge = challenges.get(scope);
      if (!challenge) return null;
      if (challenge.expiresAt <= now()) {
        challenges.delete(scope);
        return null;
      }
      challenge.attempts += 1;
      const accepted = timingSafeEqual(challenge.digest, digest(code));
      if (accepted || challenge.attempts >= MAX_ATTEMPTS)
        challenges.delete(scope);
      return accepted ? challenge.issuer : null;
    },
    cancel(scope: string, issuer: string, id: string) {
      const challenge = challenges.get(scope);
      if (challenge?.issuer !== issuer || challenge.id !== id) return false;
      challenges.delete(scope);
      return true;
    },
    revokeIssuer(issuer: string) {
      for (const [scope, challenge] of challenges)
        if (challenge.issuer === issuer) challenges.delete(scope);
    },
    close() {
      challenges.clear();
    },
  };
}
