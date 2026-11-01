"use client";

/**
 * One-time note when Auto picked lite graphics for this device (lib/deviceTier.ts): what is
 * hidden and where to turn it back on. Dismissed for good on this device.
 */
import Link from "next/link";
import { dismissLiteNote, useLiteNote } from "@/lib/deviceTier";
import { PixelIcon } from "./icons";

export const LITE_NOTE = "Lite graphics on this device: horses' body builds and long hair are hidden to keep the game smooth. You can turn them on in Settings.";

export function LiteGraphicsNote() {
  const due = useLiteNote();
  if (!due) return null;
  return (
    <div className="lite-note" role="status" data-testid="lite-note">
      <p className="surface lite-note-card">
        <span>
          Lite graphics on this device: horses&rsquo; body builds and long hair are hidden to keep the game smooth. You can turn them on in{" "}
          <Link className="link" href="/me#display" onClick={dismissLiteNote}>
            Settings
          </Link>
          .
        </span>
        <button type="button" className="lite-note-close" onClick={dismissLiteNote} aria-label="Dismiss">
          <PixelIcon name="cross" size={12} />
        </button>
      </p>
    </div>
  );
}
