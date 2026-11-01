import { loginCodesEnabled } from "@/server/loginCode";
import { LinkClient } from "./LinkClient";

export const dynamic = "force-dynamic";

/** Sign in: your invite link and your login code (testing phase), a device code, or your wallet. */
export default function LinkPage() {
  return <LinkClient testing={loginCodesEnabled()} />;
}
