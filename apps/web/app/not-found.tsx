import Link from "next/link";
import { Crest } from "@/components/icons";

export default function NotFound() {
  return (
    <div className="mx-auto grid max-w-lg gap-4 pt-8">
      <div className="surface flex flex-col items-center gap-3 px-6 py-10 text-center">
        <Crest size={96} />
        <h1 className="t-page">Not on the card</h1>
        <p className="text-cream-dim">That race or horse isn&rsquo;t on today&rsquo;s card at Kestrel Downs, or its link has changed.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Link href="/" className="btn btn-brass btn-lg">
            Back to your yard
          </Link>
          <Link href="/races" className="btn btn-outline">
            See the race card
          </Link>
        </div>
      </div>
    </div>
  );
}
