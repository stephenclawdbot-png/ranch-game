#!/usr/bin/env node
// End of the beta: wipe practice T-USDG (docs/usdg-market.md "Practice mode", "Reset").
// Calls the admin action POST /api/admin/usdg { action: "practice_reset", apply } on a running
// deployment. A DRY RUN by default: it prints what would be removed and changes nothing.
//
//   ADMIN_SECRET=... node apps/web/scripts/practice-reset.mjs --url https://<host>            # dry run
//   ADMIN_SECRET=... node apps/web/scripts/practice-reset.mjs --url https://<host> --apply    # wipe
//
// Apply drains every T-USDG balance (players, the tote's T-USDG escrow and house) to the practice
// burn, frees horses locked by open practice listings, releases pending practice stud bookings,
// and deletes practice orders, bids, listings, registrations, T-USDG Premium Pack orders and
// T-USDG tote bets and pools. Horses, foals and trophies stay with their current owners. Stable
// Credits are never touched. The one-off 100 T-USDG grant is NOT given again afterwards.
const args = process.argv.slice(2);
const urlArg = args[args.indexOf("--url") + 1];
const apply = args.includes("--apply");
const secret = process.env.ADMIN_SECRET?.trim();
if (!args.includes("--url") || !urlArg || !secret) {
  console.error("Usage: ADMIN_SECRET=... node apps/web/scripts/practice-reset.mjs --url https://<host> [--apply]");
  process.exit(2);
}
const res = await fetch(new URL("/api/admin/usdg", urlArg), {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-secret": secret },
  body: JSON.stringify({ action: "practice_reset", apply }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`HTTP ${res.status}`, body);
  process.exit(1);
}
console.log(apply ? "APPLIED: practice T-USDG wiped." : "DRY RUN (nothing changed). Re-run with --apply to wipe:");
console.log(JSON.stringify(body.reset ?? body, null, 2));
