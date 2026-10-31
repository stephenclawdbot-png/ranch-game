import { trainerPortrait } from "@/lib/cast";

/**
 * A Story rival trainer's own bust (art/portraits/trainers, 128 px PixelLab portraits). `size`
 * 128 shows the whole bust; 64 shows it at 1x cropped to the head and shoulders (native pixels).
 */
export function TrainerPortrait({ rivalId, name, size = 128 }: { rivalId: string; name: string; size?: 64 | 128 }) {
  const src = trainerPortrait(rivalId);
  if (!src) return null;
  const crop = size === 64 ? { x: 32, y: 8 } : { x: 0, y: 0 };
  return (
    <span className="well inline-grid shrink-0 place-items-center overflow-hidden" style={{ width: size + 8, height: size + 8 }} data-testid="trainer-portrait">
      <span
        role="img"
        aria-label={`${name}, trainer`}
        style={{
          display: "block",
          width: size,
          height: size,
          backgroundImage: `url(${src})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: "128px 128px",
          backgroundPosition: `-${crop.x}px -${crop.y}px`,
          imageRendering: "pixelated",
        }}
      />
    </span>
  );
}
