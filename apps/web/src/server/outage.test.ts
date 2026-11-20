/**
 * The outage answer: when the database is unreachable or over quota, API routes say so with a
 * 503 the client recognises (never a bare 500), pages are sent to the outage screen, and
 * everything else keeps its own error.
 */
import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn((to: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${to};307;` });
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

import { DB_UNAVAILABLE, DomainError } from "@thoroughbred/db";
import { OUTAGE_CODE, safeReturnPath } from "@/lib/outage";
import { handleError } from "./http";
import { dbPage, orWhenDown, outageHref } from "./outage";

const quota = () => Object.assign(new Error("Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits."), { code: "53000" });
const refused = () => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });

describe("API routes during an outage", () => {
  it("answer 503 db_unavailable with a plain message, never cached", async () => {
    for (const err of [quota(), refused(), new Error("Failed query: select 1", { cause: quota() })]) {
      const res = handleError(err);
      expect(res.status).toBe(503);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("Retry-After")).toBe("120");
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe(DB_UNAVAILABLE);
      expect(body.message).toMatch(/yard is closed/i);
      expect(body.message).toMatch(/stable is safe/i);
      // nothing of the driver's error reaches the player
      expect(JSON.stringify(body)).not.toMatch(/quota|ECONNREFUSED|select/i);
    }
  });

  it("the client and the server agree on the code", () => {
    expect(OUTAGE_CODE).toBe(DB_UNAVAILABLE);
  });

  it("game rules and real bugs keep their own answers", () => {
    expect(handleError(new DomainError("RACE_FULL", "full")).status).not.toBe(503);
    expect(() => handleError(new Error('column "nope" does not exist'))).toThrow();
  });
});

describe("pages during an outage", () => {
  it("dbPage sends the player to the outage page with the way back", async () => {
    redirect.mockClear();
    await expect(
      dbPage("/horse/abc?tab=care", async () => {
        throw quota();
      }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/outage?from=%2Fhorse%2Fabc%3Ftab%3Dcare");
    expect(outageHref("/races")).toBe("/outage?from=%2Fraces");
  });

  it("dbPage leaves other errors and ordinary results alone", async () => {
    redirect.mockClear();
    await expect(dbPage("/x", async () => 42)).resolves.toBe(42);
    await expect(
      dbPage("/x", async () => {
        throw new Error("a real bug");
      }),
    ).rejects.toThrow("a real bug");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("orWhenDown falls back only for an outage", async () => {
    await expect(orWhenDown(async () => { throw refused(); }, "fallback")).resolves.toBe("fallback");
    await expect(orWhenDown(async () => "live", "fallback")).resolves.toBe("live");
    await expect(orWhenDown(async () => { throw new Error("bug"); }, "fallback")).rejects.toThrow("bug");
  });

  it("Try again only ever returns to a path on this site", () => {
    expect(safeReturnPath("/races")).toBe("/races");
    expect(safeReturnPath("/race/abc?at=finish")).toBe("/race/abc?at=finish");
    for (const bad of ["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/outage?from=/outage", "", null, undefined, "/" + "a".repeat(400)]) expect(safeReturnPath(bad)).toBeNull();
  });
});
