import { z } from "zod";
import { RunningStyleSchema } from "@thoroughbred/shared";

/** What a client may choose for a ride: never speeds or outcomes. */
export const PlanSchema = z.object({
  tactic: RunningStyleSchema,
  intensity: z.enum(["conservative", "normal", "all_out"]).default("normal"),
});
export const HorseIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
