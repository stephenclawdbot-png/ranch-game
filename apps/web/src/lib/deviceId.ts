/**
 * A random id for this browser (localStorage), sent only by the "Bring a rival" flow: the inviter
 * when opening their rival link, the friend when founding through it. The server stores it hashed
 * as a device signal, so the same browser on both sides is a linked pair and gets no welcome.
 */
const KEY = "pt.device";

export function deviceId(): string | undefined {
  try {
    let v = window.localStorage.getItem(KEY);
    if (!v || !/^[A-Za-z0-9-]{8,64}$/.test(v)) {
      v = crypto.randomUUID();
      window.localStorage.setItem(KEY, v);
    }
    return v;
  } catch {
    return undefined;
  }
}
