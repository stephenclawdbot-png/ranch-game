import { redirect } from "next/navigation";

/** The Club area lives at /league, /cup and /hall (the Club tab opens the league). */
export default function ClubPage() {
  redirect("/league");
}
