import Link from "next/link";
import { Crest } from "@/components/icons";

export default function NotFound() {
  return (
    <div className="px-panel mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-14 text-center">
      <Crest className="h-16 w-16 animate-bob" />
      <p className="eyebrow">Stewards&rsquo; enquiry</p>
      <h1 className="display text-3xl">Not on the card</h1>
      <p className="text-sm text-cream-dim">That race or horse doesn&rsquo;t exist — or its ticket has been tampered with.</p>
      <Link href="/" className="btn btn-brass">
        Back to the Paddock
      </Link>
    </div>
  );
}
