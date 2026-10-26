import { expect } from "chai";
import hre from "hardhat";
import { getAddress, keccak256, toBytes } from "viem";
import { deployThoroughbred, DEFAULT_CATALOGUE } from "../scripts/deploy";
import { parseTokenAmount, skuId } from "../adapter/voucher";
import { DEFAULT_ADMIN_ROLE } from "./helpers";

describe("scripts/deploy.ts (against the local Hardhat network)", () => {
  it("deploys, configures the catalogue and keeps the deployer as admin by default", async () => {
    const usd = await hre.viem.deployContract("MockStablecoin", []);
    const r = await deployThoroughbred(hre, { paymentToken: usd.address });
    const store = await hre.viem.getContractAt("PremiumStore", r.premiumStore);
    expect(await store.read.acceptedToken([usd.address])).to.equal(true);
    for (const item of DEFAULT_CATALOGUE) {
      expect(await store.read.priceOf([skuId(item.sku), usd.address])).to.equal(parseTokenAmount(item.price, 6));
      expect(await store.read.skuActive([skuId(item.sku)])).to.equal(item.active);
    }
    expect(await store.read.hasRole([DEFAULT_ADMIN_ROLE, r.deployer])).to.equal(true);
    expect(r.gameToken).to.equal(undefined); // the token is opt-in
    const pool = await hre.viem.getContractAt("PrizePool", r.prizePool);
    expect(getAddress(await store.read.prizePool())).to.equal(getAddress(r.prizePool));
    expect(await store.read.poolBps()).to.equal(3000);
    expect(await pool.read.hasRole([keccak256(toBytes("FUNDER_ROLE")), store.address])).to.equal(true);
    expect(await pool.read.hasRole([keccak256(toBytes("POSTER_ROLE")), r.deployer])).to.equal(true);
  });

  it("hands admin over to a separate address (multisig) and renounces the deployer", async () => {
    const [, multisig, server] = await hre.viem.getWalletClients();
    const usd = await hre.viem.deployContract("MockStablecoin", []);
    const r = await deployThoroughbred(hre, {
      paymentToken: usd.address,
      admin: getAddress(multisig!.account.address),
      publisher: getAddress(server!.account.address),
      storeSigner: getAddress(server!.account.address),
      poolPoster: getAddress(server!.account.address),
      deployGameToken: true,
    });
    const store = await hre.viem.getContractAt("PremiumStore", r.premiumStore);
    const registry = await hre.viem.getContractAt("RaceProofRegistry", r.raceProofRegistry);
    for (const c of [store, registry]) {
      expect(await c.read.hasRole([DEFAULT_ADMIN_ROLE, r.deployer])).to.equal(false);
      expect(await c.read.hasRole([DEFAULT_ADMIN_ROLE, r.admin])).to.equal(true);
      expect(await c.read.hasRole([keccak256(toBytes("PAUSER_ROLE")), r.deployer])).to.equal(false);
    }
    expect(await registry.read.hasRole([keccak256(toBytes("PUBLISHER_ROLE")), getAddress(server!.account.address)])).to.equal(true);
    expect(await store.read.hasRole([keccak256(toBytes("SIGNER_ROLE")), getAddress(server!.account.address)])).to.equal(true);
    expect(await store.read.treasury()).to.equal(r.admin);
    const pool = await hre.viem.getContractAt("PrizePool", r.prizePool);
    for (const name of ["PAUSER_ROLE", "FUNDER_ROLE"]) expect(await pool.read.hasRole([keccak256(toBytes(name)), r.deployer])).to.equal(false);
    expect(await pool.read.hasRole([DEFAULT_ADMIN_ROLE, r.deployer])).to.equal(false);
    expect(await pool.read.hasRole([DEFAULT_ADMIN_ROLE, r.admin])).to.equal(true);
    expect(await pool.read.hasRole([keccak256(toBytes("POSTER_ROLE")), r.admin])).to.equal(true);
    expect(await pool.read.hasRole([keccak256(toBytes("POSTER_ROLE")), getAddress(server!.account.address)])).to.equal(true);
    expect(r.gameToken).to.match(/^0x[0-9a-fA-F]{40}$/);
    const token = await hre.viem.getContractAt("ThoroughbredToken", r.gameToken!);
    expect(await token.read.totalSupply()).to.equal(0n); // genesis is a separate reviewed step
  });
});
