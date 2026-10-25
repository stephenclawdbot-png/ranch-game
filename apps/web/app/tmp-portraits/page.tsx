"use client";
import { HorsePortrait } from "@/components/HorsePortrait";
import { Silks } from "@/components/Silks";
import { CoatSchema, FaceMarkingSchema, SilkPatternSchema } from "@thoroughbred/shared";
const silks = { pattern: "hoops", primary: "#16224d", secondary: "#e2b33c", cap: "#e2b33c" } as const;
export default function P() {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {CoatSchema.options.map((coat, i) => (
          <div key={coat} className="panel aspect-square"><HorsePortrait appearance={{ coat, face: FaceMarkingSchema.options[i % 6]!, legs: ["none","none","none","none"], silks }} className="h-full w-full" /><p className="text-xs">{coat} {FaceMarkingSchema.options[i % 6]}</p></div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">{SilkPatternSchema.options.map((p) => <Silks key={p} silks={{ ...silks, pattern: p }} className="h-24 w-24" />)}</div>
    </div>
  );
}
