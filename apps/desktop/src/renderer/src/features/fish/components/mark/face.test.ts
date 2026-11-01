import { describe, expect, it } from "vitest";
import { createAvatar } from "./face";

const head = { x: 10, y: 8, rx: 4, ry: 3.4 };
const pivot = { x: 10, y: 12 };

function fish() {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return createAvatar({ head, pivot, random });
}

function run(avatar: ReturnType<typeof fish>, seconds: number) {
  let pose = avatar.step(0);
  for (let t = 0; t < seconds; t += 1 / 60) pose = avatar.step(1 / 60);
  return pose;
}

describe("fish face", () => {
  it("grows sleepy, then falls asleep when left alone", () => {
    const avatar = fish();
    expect(run(avatar, 25).mood).toBe("sleepy");
    expect(run(avatar, 6).mood).toBe("asleep");
  });

  it("wakes when the pointer comes near", () => {
    const avatar = fish();
    run(avatar, 31);
    avatar.enter();
    avatar.move(40, -10);
    expect(run(avatar, 0.5).mood).toBe("attentive");
  });

  it("stays awake while it has work", () => {
    const avatar = fish();
    avatar.task("reading");
    expect(run(avatar, 40).mood).toBe("reading");
  });

  it("hops happily when pressed, then settles", () => {
    const avatar = fish();
    avatar.press();
    expect(run(avatar, 0.3).mood).toBe("happy");
    expect(run(avatar, 1.5).mood).toBe("idle");
  });

  it("keeps the followed gaze on the face", () => {
    const avatar = fish();
    avatar.enter();
    avatar.move(4000, 0);
    const [, front] = run(avatar, 3).eyes;
    expect(front.opacity).toBeGreaterThan(0);
  });
});
