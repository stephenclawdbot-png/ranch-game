import type { Silks as SilksT } from "@thoroughbred/shared";
import { Silks } from "./Silks";

/**
 * A stable's badge: its photo when it has one, else its racing silks (unchanged). The photo is
 * the server's own re-encoded 256x256 WebP served same-origin, so a plain <img> with the same
 * footprint the silks use (same className sizing); rendered smooth, not pixelated.
 */
export function StableBadge(props: { silks: SilksT; photoUrl?: string | null; className?: string; cap?: boolean; alt?: string }) {
  const { silks, photoUrl, className, cap, alt } = props;
  if (!photoUrl) return <Silks silks={silks} className={className} cap={cap} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- same-origin and already 256x256; next/image adds nothing
    <img
      src={photoUrl}
      alt={alt ?? ""}
      className={`rounded-[4px] object-cover ${className ?? ""}`}
      style={{ boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.4)" }}
      loading="lazy"
      decoding="async"
    />
  );
}