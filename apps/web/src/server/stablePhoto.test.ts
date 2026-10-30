/**
 * Stable photo, web side: /api/account/photo (upload + remove) and /api/stables/[id]/photo
 * (public image). Uses the shared PGlite singleton, like the routes, at real time. Every upload
 * is re-encoded server-side; the tests check the stored bytes are a fresh 256x256 WebP with no
 * EXIF, and that hostile uploads (SVG, HTML, GIF, oversized, pixel bombs) never get stored.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }) }));

import { DELETE, POST } from "../../app/api/account/photo/route";
import { GET } from "../../app/api/stables/[id]/photo/route";
import { createAccount, stableOf, type DbHandle } from "@thoroughbred/db";
import * as gc from "@thoroughbred/game-core";
import sharp from "sharp";
import { dbHandle } from "./db";

let h: DbHandle;
const silks = { pattern: "hoops", primary: "#8e2323", secondary: "#f3e7c9", cap: "#263238" } as const;

beforeAll(async () => {
  h = await dbHandle();
});
afterAll(async () => {
  jar.token = null;
});

async function founded(name: string) {
  const acc = await createAccount(h.db, { stableName: name, silks, startingCredits: 10_000, timezone: "Europe/London", now: new Date() });
  return { token: acc.token, accountId: acc.accountId, stableId: (await stableOf(h.db, acc.accountId)).id };
}

// ---------------------------------------------------------------------------
// Test images, built with sharp itself
// ---------------------------------------------------------------------------

const image = (format: "png" | "jpeg" | "webp", background = "#884422") =>
  sharp({ create: { width: 600, height: 400, channels: 3, background } })
    [format]()
    .toBuffer();

async function upload(buf: Buffer, name = "photo.png", type = "image/png", origin?: string) {
  const form = new FormData();
  form.append("photo", new File([new Uint8Array(buf)], name, { type }));
  return POST(new Request("https://tb.example/api/account/photo", { method: "POST", body: form, headers: origin ? { Origin: origin } : undefined }));
}

const remove = (origin?: string) =>
  DELETE(new Request("https://tb.example/api/account/photo", { method: "DELETE", headers: origin ? { Origin: origin } : undefined }));

const getPhoto = (stableId: string, v?: string, etag?: string) =>
  GET(
    new Request(`https://tb.example/api/stables/${stableId}/photo${v ? `?v=${v}` : ""}`, {
      headers: etag ? { "If-None-Match": etag } : undefined,
    }),
    { params: Promise.resolve({ id: stableId }) },
  ) as unknown as Promise<Response>;

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("stable photo upload", () => {
  it("accepts a PNG, JPEG and WebP; stores a 256x256 WebP behind the security headers", async () => {
    const p = await founded("Photo Park");
    jar.token = p.token;

    for (const format of ["png", "jpeg", "webp"] as const) {
      const res = await upload(await image(format));
      expect(res.status).toBe(200);
      const { photoUrl } = (await res.json()) as { photoUrl: string };
      expect(photoUrl).toMatch(new RegExp(`^/api/stables/${p.stableId}/photo\\?v=[0-9a-f]{64}$`));

      const v = photoUrl.split("v=")[1]!;
      const stored = await getPhoto(p.stableId, v);
      expect(stored.status).toBe(200);
      expect(stored.headers.get("Content-Type")).toBe("image/webp");
      expect(stored.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(stored.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
      expect(stored.headers.get("Content-Disposition")).toBe('inline; filename="stable.webp"');
      expect(stored.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
      expect(stored.headers.get("ETag")).toBe(`"${v}"`);

      const bytes = Buffer.from(await stored.arrayBuffer());
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(gc.STABLE_PHOTO_SIZE);
      expect(meta.height).toBe(gc.STABLE_PHOTO_SIZE);

      // the same hash answers If-None-Match with 304
      const notModified = await getPhoto(p.stableId, v, `"${v}"`);
      expect(notModified.status).toBe(304);
    }
  });

  it("re-encodes: EXIF never survives", async () => {
    const p = await founded("Exifless End");
    jar.token = p.token;
    const jpeg = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#884422" } })
      .withMetadata({ exif: { IFD0: { Copyright: "secret" } } })
      .jpeg()
      .toBuffer();
    const before = await sharp(jpeg).metadata();
    expect(before.exif).toBeDefined();

    const res = await upload(jpeg, "photo.jpg", "image/jpeg");
    expect(res.status).toBe(200);
    const { photoUrl } = (await res.json()) as { photoUrl: string };
    const stored = await getPhoto(p.stableId, photoUrl.split("v=")[1]!);
    const meta = await sharp(Buffer.from(await stored.arrayBuffer())).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("removes the photo (silks show again)", async () => {
    const p = await founded("Remove Ridge");
    jar.token = p.token;
    expect((await upload(await image("png"))).status).toBe(200);
    const res = await remove();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { photoUrl: string | null }).photoUrl).toBeNull();
    expect((await getPhoto(p.stableId)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Refused uploads
// ---------------------------------------------------------------------------

describe("stable photo refusals", () => {
  it("refuses an SVG whatever the filename says", async () => {
    const p = await founded("Safe Sound");
    jar.token = p.token;
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    const res = await upload(svg, "photo.png", "image/png");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("format");
    expect((await getPhoto(p.stableId)).status).toBe(404);
  });

  it("refuses an HTML file named .png", async () => {
    jar.token = (await founded("Plainfield")).token;
    const res = await upload(Buffer.from("<html><body><script>alert(1)</script></body></html>"), "photo.png", "image/png");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("not_an_image");
  });

  it("refuses a GIF", async () => {
    const p = await founded("Gifless Gate");
    jar.token = p.token;
    const gif = await sharp({ create: { width: 60, height: 40, channels: 3, background: "#884422" } }).gif().toBuffer();
    const res = await upload(gif, "photo.gif", "image/gif");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("format");
  });

  it("refuses a request that declares a body over the cap before parsing it", async () => {
    jar.token = (await founded("Longfield Rise")).token;
    const res = await POST(
      new Request("https://tb.example/api/account/photo", {
        method: "POST",
        body: "x",
        headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(gc.STABLE_PHOTO_MAX_UPLOAD_BYTES * 4) },
      }),
    );
    expect(res.status).toBe(413);
  });

  it("refuses a body over the size cap before reading it", async () => {
    jar.token = (await founded("Smallbarn")).token;
    const res = await upload(Buffer.alloc(gc.STABLE_PHOTO_MAX_UPLOAD_BYTES + 1024, 1), "photo.png", "image/png");
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe("too_large");
  });

  it("refuses a pixel bomb (over the decoded-pixel cap)", async () => {
    jar.token = (await founded("Bombless Brook")).token;
    const bomb = await sharp({ create: { width: 10_000, height: 10_000, channels: 3, background: "#884422" } }).png().toBuffer();
    const res = await upload(bomb, "photo.png", "image/png");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("too_many_pixels");
  });

  it("needs a stable", async () => {
    jar.token = null;
    const res = await upload(await image("png"));
    expect(res.status).toBe(401);
  });

  it("refuses a cross-site Origin", async () => {
    const p = await founded("Originfield");
    jar.token = p.token;
    const res = await upload(await image("png"), "photo.png", "image/png", "https://evil.example");
    expect(res.status).toBe(403);
    expect((await getPhoto(p.stableId)).status).toBe(404);
    expect((await remove("https://evil.example")).status).toBe(403);
  });

  it("refuses the 6th change of the day", async () => {
    const p = await founded("Rateless Rill");
    jar.token = p.token;
    for (let i = 0; i < gc.STABLE_PHOTO_UPLOADS_PER_DAY; i++) {
      expect((await upload(await image("png"))).status).toBe(200);
    }
    const res = await upload(await image("png"));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("RATE_LIMITED");
    expect((await remove()).status).toBe(429);
  });
});

describe("GET /api/stables/[id]/photo", () => {
  it("rejects a non-uuid id and 404s a stable with no photo", async () => {
    jar.token = null;
    expect((await getPhoto("not-a-uuid")).status).toBe(400);
    const p = await founded("Nosilks Norwood");
    expect((await getPhoto(p.stableId)).status).toBe(404);
  });

  it("caches only when the URL carries the current hash", async () => {
    const p = await founded("Cacheburn Common");
    jar.token = p.token;
    const { photoUrl } = (await (await upload(await image("png"))).json()) as { photoUrl: string };
    const v = photoUrl.split("v=")[1]!;
    expect((await getPhoto(p.stableId)).headers.get("Cache-Control")).toBe("no-cache");
    expect((await getPhoto(p.stableId, "stale")).headers.get("Cache-Control")).toBe("no-cache");
    expect((await getPhoto(p.stableId, v)).headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });
});