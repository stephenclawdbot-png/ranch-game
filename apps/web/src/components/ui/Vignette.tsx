import { VIGNETTE_SIZE, vignetteSrc, type VignetteName } from "@/lib/cast";

/** A 64 px framed PixelLab vignette (art/vignettes) for a kind of news, moment or empty state, at 1x. */
export function Vignette({ name, className = "" }: { name: VignetteName; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={vignetteSrc(name)}
      width={VIGNETTE_SIZE}
      height={VIGNETTE_SIZE}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      className={`shrink-0 ${className}`}
      style={{ imageRendering: "pixelated", width: VIGNETTE_SIZE, height: VIGNETTE_SIZE }}
      data-vignette={name}
    />
  );
}
