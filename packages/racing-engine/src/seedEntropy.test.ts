import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { commitSeed, mixSeedEntropy } from "./index";

describe("mixSeedEntropy (real-money races only)", () => {
  const seed = "11".repeat(32);
  const entropy = "ab".repeat(32);

  it("is sha256 over the 64 raw bytes seed ‖ entropy (TotePools.finalSeedOf)", () => {
    const expected = createHash("sha256").update(Buffer.from(seed + entropy, "hex")).digest("hex");
    expect(mixSeedEntropy(seed, entropy)).toBe(expected);
  });

  it("changes with either input and never equals the plain server seed", () => {
    const a = mixSeedEntropy(seed, entropy);
    expect(mixSeedEntropy("12".repeat(32), entropy)).not.toBe(a);
    expect(mixSeedEntropy(seed, "ac".repeat(32))).not.toBe(a);
    expect(a).not.toBe(seed);
    expect(commitSeed(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects anything but 32 bytes of lowercase hex", () => {
    expect(() => mixSeedEntropy("0x" + seed.slice(2), entropy)).toThrow();
    expect(() => mixSeedEntropy(seed, "AB".repeat(32))).toThrow();
    expect(() => mixSeedEntropy(seed, "ab")).toThrow();
  });
});
