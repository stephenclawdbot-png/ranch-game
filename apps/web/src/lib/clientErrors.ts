/**
 * The last few client-side errors (window error / unhandled rejection), attached to feedback
 * reports so a "something broke" note comes with the actual error. Never sent on its own.
 */
const MAX = 10;
const recent: string[] = [];
let installed = false;

function push(msg: string) {
  recent.push(`${new Date().toISOString().slice(11, 19)} ${msg}`.slice(0, 500));
  if (recent.length > MAX) recent.shift();
}

export function installClientErrorLog(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => push(`${e.message}${e.filename ? ` @ ${e.filename.split("/").pop()}:${e.lineno}` : ""}`));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { message?: string } | string | undefined;
    push(`unhandled: ${typeof r === "string" ? r : (r?.message ?? "rejection")}`);
  });
}

export function recentClientErrors(): string[] {
  return [...recent];
}
