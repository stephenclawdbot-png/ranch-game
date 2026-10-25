import { RigHarness } from "./RigHarness";

export const dynamic = "force-dynamic";

/**
 * Pixel-rig visual harness (dev only).
 * Query: mode=grid|strip|morph|bench, paused=1, t=<s>, phase=<0..1>, sun=<az>,<el>, gen=1, n=<rigs>, speed=<m/s>.
 */
export default function RigDevPage() {
  return <RigHarness />;
}
