import type { Metadata } from "next";

export const metadata: Metadata = { title: "Breeding barn" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
