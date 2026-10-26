import { expect } from "chai";
import hre from "hardhat";
import { toEventSelector, toFunctionSelector, type Abi, type AbiEvent, type AbiFunction } from "viem";
import { premiumStoreAbi, prizePoolAbi, raceProofRegistryAbi } from "../adapter/abi";

function check(name: string, handWritten: Abi, compiled: Abi) {
  for (const item of handWritten) {
    if (item.type === "function") {
      const match = compiled.find((c): c is AbiFunction => c.type === "function" && c.name === item.name);
      expect(match, `${name}.${item.name} missing from artifact`).to.not.equal(undefined);
      expect(toFunctionSelector(item), `${name}.${item.name} selector`).to.equal(toFunctionSelector(match!));
      expect(item.outputs.map((o) => o.type), `${name}.${item.name} outputs`).to.deep.equal(match!.outputs.map((o) => o.type));
      expect(item.stateMutability, `${name}.${item.name} mutability`).to.equal(match!.stateMutability);
    } else if (item.type === "event") {
      const match = compiled.find((c): c is AbiEvent => c.type === "event" && c.name === item.name);
      expect(match, `${name}.${item.name} event missing`).to.not.equal(undefined);
      expect(toEventSelector(item)).to.equal(toEventSelector(match!));
      expect(item.inputs.map((i) => i.indexed ?? false)).to.deep.equal(match!.inputs.map((i) => i.indexed ?? false));
    }
  }
}

describe("adapter ABIs match compiled contracts", () => {
  it("RaceProofRegistry", async () => {
    check("RaceProofRegistry", raceProofRegistryAbi, (await hre.artifacts.readArtifact("RaceProofRegistry")).abi as Abi);
  });
  it("PremiumStore", async () => {
    check("PremiumStore", premiumStoreAbi, (await hre.artifacts.readArtifact("PremiumStore")).abi as Abi);
  });
  it("PrizePool", async () => {
    check("PrizePool", prizePoolAbi, (await hre.artifacts.readArtifact("PrizePool")).abi as Abi);
  });
});
