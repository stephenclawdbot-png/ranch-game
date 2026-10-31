"use client";
/**
 * The top bar's "Connect wallet" for signed-out visitors: one dialog, one signature. A wallet
 * with a stable signs this browser in; an unknown wallet goes on to found a stable (invite step).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WalletSignIn } from "./WalletSignIn";

export function ConnectWalletButton({
  className = "btn btn-sm btn-brass",
  testId = "nav-connect-wallet",
}: {
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  /** The dialog is portalled to <body> (the button can sit inside a paragraph or a form). */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open, mounted]);
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        data-testid={testId}
      >
        Connect wallet
      </button>
      {mounted &&
        createPortal(
          <dialog
            ref={ref}
            onClose={() => setOpen(false)}
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false); // backdrop tap closes
            }}
            className="surface m-auto w-[min(26rem,calc(100vw-2rem))] p-0 text-cream backdrop:bg-black/60"
            aria-labelledby="connect-wallet-title"
            data-testid="connect-wallet-dialog"
          >
            {open && (
              <div className="grid gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="connect-wallet-title" className="t-h2">
                    Connect wallet
                  </h2>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
                <p className="t-meta">
                  Your wallet is your login. One free signature: no transaction,
                  no gas. New here? You&rsquo;ll found your stable next.
                </p>
                <WalletSignIn
                  auto
                  label="Choose your wallet"
                  onNeedsStable={() => {
                    setOpen(false);
                    router.push("/play");
                  }}
                />
                <p className="caption">
                  No wallet?{" "}
                  <Link
                    href="/play"
                    className="link"
                    onClick={() => setOpen(false)}
                  >
                    Play without one
                  </Link>{" "}
                  ·{" "}
                  <Link
                    href="/link"
                    className="link"
                    onClick={() => setOpen(false)}
                  >
                    Use a device code
                  </Link>
                </p>
              </div>
            )}
          </dialog>,
          document.body,
        )}
    </>
  );
}
