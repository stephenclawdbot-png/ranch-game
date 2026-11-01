/* Post Time service worker: phone / desktop alerts only (no offline caching).
 *
 * push              shows the alert the server sent ({ title, body, url, tag }). Alerts share a tag
 *                   per race or horse event, so a newer one replaces the older (never a stack).
 *                   In Chromium browsers, when a Post Time window is focused the alert is skipped
 *                   (the bell already has it); Safari and Firefox always show it, as they require.
 * notificationclick focuses an open Post Time window on that page, or opens one.
 * pushsubscriptionchange  re-subscribes with the same key and tells the server.
 */
const ICON = "/brand/icon-192.png";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function safeUrl(u) {
  try {
    const url = new URL(typeof u === "string" ? u : "/", self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Post Time";
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    icon: ICON,
    badge: ICON,
    tag: typeof data.tag === "string" && data.tag ? data.tag : "post-time",
    renotify: true,
    data: { url: safeUrl(data.url), kind: data.kind || null },
  };
  event.waitUntil(
    (async () => {
      if (/Chrome\/|Edg\//.test(self.navigator.userAgent)) {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        const focused = windows.find((c) => c.focused && c.visibilityState === "visible");
        if (focused) {
          focused.postMessage({ type: "push", title, body: options.body, url: options.data.url });
          return;
        }
      }
      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const target = new URL(path, self.location.origin).href;
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const same = windows.find((c) => c.url === target);
      if (same) return same.focus();
      const any = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (any) {
        await any.focus();
        if ("navigate" in any) return any.navigate(target).catch(() => self.clients.openWindow(target));
        return undefined;
      }
      return self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const key = old && old.options ? old.options.applicationServerKey : null;
      const sub = event.newSubscription || (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
      if (!sub) return;
      await fetch("/api/push/device", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      }).catch(() => undefined);
    })(),
  );
});
