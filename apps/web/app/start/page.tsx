import { redirect } from "next/navigation";

/** /start is an alias of /play (found a stable). */
export default function StartPage() {
  redirect("/play");
}
