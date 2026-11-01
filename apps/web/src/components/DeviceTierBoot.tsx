"use client";

/**
 * Loads the device tier (lib/deviceTier.ts) with the app, before any horse is painted: the module
 * registers the tier with art-pipeline's buildsOn when it loads. Renders nothing.
 */
import "@/lib/deviceTier";

export function DeviceTierBoot() {
  return null;
}
