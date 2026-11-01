"use client";
/**
 * Testing phase, first thing after naming the stable (before the mentor and the first race):
 * "Your key to come back". The tester's permanent login code, big, with Copy and Save as image
 * (or Share where the browser can share files), one line about the invite link, and one brass
 * button. One screen, under ten seconds. Copying, saving or sharing records the login-code mark,
 * so the later reminder (after the first result) never nags a player who already saved it.
 * Players without a login code (outside the testing phase) skip straight past it.
 */
import { useEffect, useRef, useState } from "react";
import { ActionBar } from "../ui/ActionBar";
import { PixelIcon } from "../icons";
import { sendOnboarding } from "../onboarding/guide";
import { LOGIN_CODE_MARK, useLoginCode } from "./LoginCodeCard";

/** Where the code is typed in (shown on the saved card). */
export const SIGN_IN_ADDRESS = "posttime.family/link";

/** The saved card's one line: which stable the code opens, and the code. */
export function keyCardLine(stableName: string, code: string): string {
  return `${stableName} · ${code}`;
}

/** Records that the player kept the code (copy, image or share): no reminder later. */
export function markLoginCodeSaved(): void {
  void sendOnboarding({ action: "coach", id: LOGIN_CODE_MARK }).catch(() => undefined);
}

/** A small PNG card: the stable name and the code, and where to type it. */
async function keyCardPng(stableName: string, code: string): Promise<Blob | null> {
  const w = 720;
  const h = 360;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#0f2418";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#c9a24a";
  g.lineWidth = 6;
  g.strokeRect(12, 12, w - 24, h - 24);
  g.textAlign = "center";
  g.fillStyle = "#c9a24a";
  g.font = "700 22px system-ui, sans-serif";
  g.fillText("POST TIME · YOUR KEY TO COME BACK", w / 2, 70);
  // The one line that says which stable the code opens: "<Stable name> · PT-…".
  g.fillStyle = "#f3ead7";
  g.font = "700 30px ui-monospace, Menlo, Consolas, monospace";
  g.fillText(keyCardLine(stableName, code), w / 2, 170, w - 60);
  g.fillStyle = "#b9c4b0";
  g.font = "500 24px system-ui, sans-serif";
  g.fillText(`Sign in at ${SIGN_IN_ADDRESS}`, w / 2, 250);
  g.font = "500 20px system-ui, sans-serif";
  g.fillText("Your invite link works too, this testing round. Keep both to yourself.", w / 2, 300, w - 60);
  return new Promise((resolve) => c.toBlob((b) => resolve(b), "image/png"));
}

function fileName(stableName: string): string {
  return `post-time-key-${stableName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "stable"}.png`;
}

export function ComeBackKey({ stableName, onDone }: { stableName: string; onDone: () => void }) {
  const code = useLoginCode();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const skipped = useRef(false);

  // No login code (outside the testing phase): nothing to show, straight on.
  useEffect(() => {
    if (code === null && !skipped.current) {
      skipped.current = true;
      onDone();
    }
  }, [code, onDone]);

  useEffect(() => {
    try {
      const probe = new File([new Uint8Array(1)], "key.png", { type: "image/png" });
      setCanShare(typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] }));
    } catch {
      setCanShare(false);
    }
  }, []);

  if (!code) return <div className="min-h-[60vh]" aria-busy />;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code!);
      setCopied(true);
      markLoginCodeSaved();
    } catch {
      /* clipboard blocked: the code stays selectable on screen */
    }
  }

  async function saveImage() {
    const blob = await keyCardPng(stableName, code!);
    if (!blob) return;
    const name = fileName(stableName);
    if (canShare) {
      try {
        await navigator.share({ files: [new File([blob], name, { type: "image/png" })], title: `${stableName}: your key to come back` });
        setSaved(true);
        markLoginCodeSaved();
        return;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        // Sharing failed for another reason: fall back to a download.
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setSaved(true);
    markLoginCodeSaved();
  }

  return (
    <div className="mx-auto grid max-w-xl gap-4" data-testid="key-screen">
      <header className="grid gap-1">
        <p className="eyebrow">First things first</p>
        <h1 className="t-display-xl">Your key to come back</h1>
      </header>
      <div className="frame-hero grid gap-3 p-4 sm:p-5">
        <p className="t-title text-center" data-testid="key-stable">
          {stableName}
        </p>
        <code className="select-all whitespace-nowrap text-center font-mono text-[1.0625rem] font-bold leading-8 min-[380px]:text-[1.125rem] sm:text-[1.75rem] sm:leading-10 sm:tracking-wider" data-testid="key-code">
          {code}
        </code>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn" onClick={() => void copy()} data-testid="key-copy">
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="btn" onClick={() => void saveImage()} data-testid="key-save">
            {saved ? "Saved" : canShare ? "Share" : "Save as image"}
          </button>
        </div>
      </div>
      <p className="t-meta">Save this code: it is how you get back in. (A personal invite link made just for you also works; a shared one does not.)</p>
      <ActionBar>
        <button type="button" className="btn btn-brass btn-lg" onClick={onDone} data-testid="key-continue">
          <PixelIcon name="horseshoe" size={32} className="-my-2" /> I&rsquo;ve saved it, let&rsquo;s race
        </button>
      </ActionBar>
    </div>
  );
}
