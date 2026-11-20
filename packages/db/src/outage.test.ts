import { describe, expect, it } from "vitest";
import { DbUnavailableError, isDbUnavailable } from "./outage";

describe("isDbUnavailable", () => {
  it("recognises Neon's quota answer (SQLSTATE 53000) by code and by message", () => {
    expect(isDbUnavailable(Object.assign(new Error("Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits."), { code: "53000" }))).toBe(true);
    expect(isDbUnavailable(new Error("Your account or project has exceeded the quota"))).toBe(true);
    expect(isDbUnavailable({ code: "53300", message: "sorry, too many clients already" })).toBe(true);
  });

  it("recognises connection failures: refused, timeouts, DNS, shutdown", () => {
    expect(isDbUnavailable(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isDbUnavailable(Object.assign(new Error("read ETIMEDOUT"), { code: "ETIMEDOUT" }))).toBe(true);
    expect(isDbUnavailable(new Error("getaddrinfo ENOTFOUND ep-example.neon.tech"))).toBe(true);
    expect(isDbUnavailable(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isDbUnavailable(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isDbUnavailable({ code: "57P03", message: "the database system is starting up" })).toBe(true);
    expect(isDbUnavailable({ code: "08006", message: "connection failure" })).toBe(true);
  });

  it("recognises the Neon driver's WebSocket error event", () => {
    class ErrorEvent {
      type = "error";
      target = {};
    }
    expect(isDbUnavailable(new ErrorEvent())).toBe(true);
    expect(isDbUnavailable({ type: "error", target: {}, message: "" })).toBe(true);
  });

  it("looks inside wrapped errors (drizzle's query error, AggregateError)", () => {
    const quota = Object.assign(new Error("exceeded the data transfer quota"), { code: "53000" });
    expect(isDbUnavailable(new Error("Failed query: select 1", { cause: quota }))).toBe(true);
    expect(isDbUnavailable(new AggregateError([new Error("nope"), Object.assign(new Error("x"), { code: "ECONNREFUSED" })]))).toBe(true);
    expect(isDbUnavailable(new DbUnavailableError(quota))).toBe(true);
    expect(isDbUnavailable(new DbUnavailableError())).toBe(true);
  });

  it("leaves real bugs and game rules alone", () => {
    expect(isDbUnavailable(new Error('column "nope" does not exist'))).toBe(false);
    expect(isDbUnavailable({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(false);
    expect(isDbUnavailable({ code: "40001", message: "could not serialize access" })).toBe(false);
    expect(isDbUnavailable({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isDbUnavailable(new Error("race not found"))).toBe(false);
    // another service being down is not the database (a chain RPC error from viem)
    expect(isDbUnavailable(Object.assign(new Error("HTTP request failed."), { shortMessage: "HTTP request failed.", cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) }))).toBe(false);
    expect(isDbUnavailable(new TypeError("fetch failed"))).toBe(false);
    expect(isDbUnavailable(null)).toBe(false);
    expect(isDbUnavailable(undefined)).toBe(false);
    expect(isDbUnavailable(42)).toBe(false);
  });
});
