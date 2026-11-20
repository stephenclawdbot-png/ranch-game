import type { Metadata } from "next";
import { OutageScreen } from "@/components/OutageScreen";

/**
 * The outage page: where server-rendered pages send players when the database is unreachable
 * or over quota (server/outage.ts dbPage). Static (it needs nothing from the database);
 * middleware.ts answers it with HTTP 503 and `Cache-Control: no-store`. "Try again" returns to
 * the page the player wanted (`?from=`).
 */
export const metadata: Metadata = { title: "The yard is closed for a moment", robots: { index: false, follow: false } };

export default function OutagePage() {
  return <OutageScreen variant="outage" />;
}
