import Link from "next/link";
import { Crest } from "@/components/icons";

export default function NotFound() {
  return (
    <div className="surface mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-12 text-center">
      <Crest className="h-16 w-[4.75rem]" />
      <h1 className="t-display-l">Not on the card</h1>
      <p className="text-cream-dim">That race or horse doesn&rsquo;t exist, or its link has been changed.</p>
      <Link href="/" className="btn btn-brass btn-lg mt-2">
        Back home
      </Link>
    </div>
  );
}
