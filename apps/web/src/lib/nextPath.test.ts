/** `?next=` after sign-in: same-origin game paths only, never an open redirect. */
import { describe, expect, it } from "vitest";
import { afterSignInHref, safeNextPath, signInHref } from "./nextPath";

describe("safeNextPath", () => {
  it("keeps the game's own pages", () => {
    for (const p of ["/race/0b8609fd-c589-5d91-8b9c-ad4f22ab63cb", "/horse/abc-123/training", "/stable", "/me/races", "/wiki/quick-start"]) expect(safeNextPath(p)).toBe(p);
  });
  it("rejects other origins, protocol-relative and scheme tricks", () => {
    for (const p of [
      "https://evil.example/race/1",
      "http:evil.example",
      "//evil.example/race/1",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/race//evil.example",
      "javascript:alert(1)",
      "/%2F%2Fevil.example",
      "/race/%2e%2e/admin",
      " /race/1",
      "/race/1\n",
      "race/1",
      "",
      null,
      undefined,
    ]) {
      expect(safeNextPath(p as string | null | undefined)).toBeNull();
    }
  });
  it("rejects query strings, fragments, dot segments and pages outside the allowlist", () => {
    for (const p of ["/race/1?x=//evil", "/race/1#x", "/race/../admin", "/admin", "/api/me", "/dev/viewer", "/link", "/play", "/", "/x".repeat(150)]) expect(safeNextPath(p)).toBeNull();
  });
  it("sign-in returns to the page, else Home with the welcome back; the Sign in link carries the page", () => {
    expect(afterSignInHref("/race/abc")).toBe("/race/abc");
    expect(afterSignInHref("//evil.example")).toBe("/?back=1");
    expect(afterSignInHref(null)).toBe("/?back=1");
    expect(signInHref("/race/abc")).toBe("/link?next=%2Frace%2Fabc");
    expect(signInHref("/")).toBe("/link");
    expect(signInHref("/link")).toBe("/link");
  });
});
