import { expect } from "chai";
import hre from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { parseEther, parseSignature } from "viem";
import { expectRevert, latestTimestamp, ZERO_ADDRESS } from "./helpers";

const CAP = parseEther("1000000");

async function fixture() {
  const [admin, minter, alice, bob] = await hre.viem.getWalletClients();
  const token = await hre.viem.deployContract("ThoroughbredToken", ["Thoroughbred", "TBRED", CAP, admin!.account.address, minter!.account.address]);
  const asMinter = await hre.viem.getContractAt("ThoroughbredToken", token.address, { client: { wallet: minter! } });
  const asAlice = await hre.viem.getContractAt("ThoroughbredToken", token.address, { client: { wallet: alice! } });
  const asBob = await hre.viem.getContractAt("ThoroughbredToken", token.address, { client: { wallet: bob! } });
  return { token, asMinter, asAlice, asBob, admin: admin!, minter: minter!, alice: alice!, bob: bob! };
}

describe("ThoroughbredToken (optional)", () => {
  it("has the expected metadata and cap, and starts with zero supply", async () => {
    const { token } = await loadFixture(fixture);
    expect(await token.read.name()).to.equal("Thoroughbred");
    expect(await token.read.symbol()).to.equal("TBRED");
    expect(await token.read.decimals()).to.equal(18);
    expect(await token.read.cap()).to.equal(CAP);
    expect(await token.read.totalSupply()).to.equal(0n);
  });

  it("only the minter mints the genesis distribution, up to the cap", async () => {
    const { token, asMinter, asAlice, alice, bob } = await loadFixture(fixture);
    await expectRevert(asAlice.write.mintGenesis([[alice.account.address], [1n]]), "AccessControlUnauthorizedAccount");
    await asMinter.write.mintGenesis([[alice.account.address, bob.account.address], [parseEther("600000"), parseEther("300000")]]);
    expect(await token.read.balanceOf([alice.account.address])).to.equal(parseEther("600000"));
    await expectRevert(asMinter.write.mintGenesis([[bob.account.address], [parseEther("100001")]]), "ERC20ExceededCap");
    await expectRevert(asMinter.write.mintGenesis([[bob.account.address], []]), "LengthMismatch");
  });

  it("finalizeGenesis permanently disables minting (admin only, once)", async () => {
    const { token, asMinter, alice } = await loadFixture(fixture);
    await asMinter.write.mintGenesis([[alice.account.address], [1n]]);
    await expectRevert(asMinter.write.finalizeGenesis(), "AccessControlUnauthorizedAccount");
    await token.write.finalizeGenesis();
    expect(await token.read.genesisFinalized()).to.equal(true);
    await expectRevert(asMinter.write.mintGenesis([[alice.account.address], [1n]]), "GenesisAlreadyFinalized");
    await expectRevert(token.write.finalizeGenesis(), "GenesisAlreadyFinalized");
  });

  it("supports EIP-2612 permit (gasless approvals)", async () => {
    const { token, asMinter, asBob, alice, bob } = await loadFixture(fixture);
    await asMinter.write.mintGenesis([[alice.account.address], [parseEther("10")]]);
    const pc = await hre.viem.getPublicClient();
    const deadline = (await latestTimestamp()) + 3600n;
    const nonce = await token.read.nonces([alice.account.address]);
    const sig = await alice.signTypedData({
      account: alice.account,
      domain: { name: "Thoroughbred", version: "1", chainId: await pc.getChainId(), verifyingContract: token.address },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner: alice.account.address, spender: bob.account.address, value: parseEther("5"), nonce, deadline },
    });
    const { v, r, s } = parseSignature(sig);
    await asBob.write.permit([alice.account.address, bob.account.address, parseEther("5"), deadline, Number(v), r, s]);
    expect(await token.read.allowance([alice.account.address, bob.account.address])).to.equal(parseEther("5"));
    // replaying the same permit fails (nonce consumed)
    await expectRevert(asBob.write.permit([alice.account.address, bob.account.address, parseEther("5"), deadline, Number(v), r, s]), "ERC2612InvalidSigner");
  });

  it("rejects zero admin/minter", async () => {
    const [a] = await hre.viem.getWalletClients();
    await expectRevert(hre.viem.deployContract("ThoroughbredToken", ["T", "T", CAP, ZERO_ADDRESS, a!.account.address]), "ZeroAddress");
    await expectRevert(hre.viem.deployContract("ThoroughbredToken", ["T", "T", CAP, a!.account.address, ZERO_ADDRESS]), "ZeroAddress");
  });
});
