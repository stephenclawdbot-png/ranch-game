/**
 * Navigate after an action (an entry, a follow-up race) and make sure it lands. A client-side
 * push can stall silently: a tab opened before a release asks the new server for the next page
 * and the router waits (2026-11-01: testers left on "Entering…"). If the page hasn't changed
 * within `ms`, load it directly.
 */
export function pushSure(router: { push: (href: string) => void }, href: string, ms = 4000): void {
  router.push(href);
  if (typeof window === "undefined") return;
  const target = href.split("?")[0];
  window.setTimeout(() => {
    if (window.location.pathname !== target) window.location.assign(href);
  }, ms);
}
