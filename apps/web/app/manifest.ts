import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Post Time",
    short_name: "Post Time",
    description: "A pixel-art racing stable game: breed, raise and race your horses at Kestrel Downs.",
    start_url: "/",
    display: "standalone",
    background_color: "#08150e",
    theme_color: "#0f2a1d",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
