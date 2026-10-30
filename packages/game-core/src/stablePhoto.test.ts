import { describe, expect, it } from "vitest";
import {
  STABLE_PHOTO_FORMATS,
  STABLE_PHOTO_MAX_INPUT_PIXELS,
  STABLE_PHOTO_MAX_UPLOAD_BYTES,
  STABLE_PHOTO_SIZE,
  STABLE_PHOTO_UPLOADS_PER_DAY,
  stablePhotoUrl,
} from "./stablePhoto";

describe("stable photo config", () => {
  it("has the owner's numbers", () => {
    expect(STABLE_PHOTO_MAX_UPLOAD_BYTES).toBe(2 * 1024 * 1024);
    expect(STABLE_PHOTO_MAX_INPUT_PIXELS).toBe(24_000_000);
    expect(STABLE_PHOTO_SIZE).toBe(256);
    expect(STABLE_PHOTO_UPLOADS_PER_DAY).toBe(5);
    expect([...STABLE_PHOTO_FORMATS]).toEqual(["png", "jpeg", "webp"]);
  });
});

describe("stablePhotoUrl", () => {
  it("is null without a photo (the silks show)", () => {
    expect(stablePhotoUrl("s1", null)).toBeNull();
  });

  it("carries the hash as the cache-busting version", () => {
    expect(stablePhotoUrl("9b4c", "abc123")).toBe("/api/stables/9b4c/photo?v=abc123");
  });
});