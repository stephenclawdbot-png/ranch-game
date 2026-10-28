import { describe, expect, it } from "vitest";
import { metamaskFallback } from "./wallet";

describe("MetaMask fallback row", () => {
  it("shows with no injected wallets: desktop install link in a new tab", () => {
    expect(metamaskFallback({ injected: [], isPhone: false, href: "https://ranch.example.com/pool?x=1" })).toEqual({
      show: true,
      caption: "Install MetaMask, then reload this page",
      url: "https://metamask.io/download/",
      newTab: true,
    });
  });

  it("is hidden when MetaMask is injected (rdns, or the legacy isMetaMask name)", () => {
    expect(metamaskFallback({ injected: [{ id: "io.metamask", name: "MetaMask" }], isPhone: false, href: "https://ranch.example.com/" }).show).toBe(false);
    expect(metamaskFallback({ injected: [{ id: "injected", name: "MetaMask" }], isPhone: true, href: "https://ranch.example.com/" }).show).toBe(false);
  });

  it("is shown when another wallet (Rabby) is injected but MetaMask isn't", () => {
    expect(metamaskFallback({ injected: [{ id: "io.rabby", name: "Rabby" }], isPhone: false, href: "https://ranch.example.com/" }).show).toBe(true);
  });

  it("deep-links phones into the app with this page's host, path and query (no protocol after /dapp/)", () => {
    expect(metamaskFallback({ injected: [], isPhone: true, href: "https://ranch.example.com/pool?tab=1" })).toEqual({
      show: true,
      caption: "Opens this page in the MetaMask app",
      url: "https://metamask.app.link/dapp/ranch.example.com/pool?tab=1",
      newTab: false,
    });
  });
});