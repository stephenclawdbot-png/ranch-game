/**
 * Scratch file from the one-off v1 fixture generator. Shell deletion needs an interactive
 * approval this session doesn't have, so it stays as a valid suite instead — safe to delete
 * (superseded by fixtures/v1-foal.json and genetics-v2.test.ts).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("v1 foal fixture", () => {
  it("the committed pre-v2 snapshot parses with every field the identity tests read", () => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/v1-foal.json", import.meta.url), "utf8"));
    for (const k of ["seed", "coi", "sire", "dam", "foal"]) expect(fixture).toHaveProperty(k);
  });
});