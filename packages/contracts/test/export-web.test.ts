import { expect } from "chai";
import fs from "node:fs";
import { renderWebContracts, WEB_CONTRACTS_PATH } from "../scripts/export-web";

describe("apps/web contracts.generated.ts", () => {
  it("is in sync with the compiled artifacts (run `pnpm --filter @thoroughbred/contracts export:web`)", () => {
    // Coverage instrumentation changes bytecode: only compare when not instrumented.
    if (process.env.SOLIDITY_COVERAGE === "true") return;
    expect(fs.existsSync(WEB_CONTRACTS_PATH), "generated file missing").to.equal(true);
    expect(fs.readFileSync(WEB_CONTRACTS_PATH, "utf8") === renderWebContracts(), "generated file is stale").to.equal(true);
  });
});
