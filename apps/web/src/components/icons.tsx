type P = { className?: string };
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function PaddockIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
      <path d="M3 20h18M5 20V9m14 11V9M3 9h18M5 13h14M8 9V5m8 4V5M6 5h12" />
    </svg>
  );
}
export function StableIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
      <path d="M6.5 20H4.8c-.6-1.8-1.3-4.4-1.3-7.3C3.5 7.4 7.3 3.5 12 3.5s8.5 3.9 8.5 9.2c0 2.9-.7 5.5-1.3 7.3h-1.7" />
      <path d="M6.5 20c-.3-1.5-.6-3.4-.6-5.4C5.9 10 8.6 7 12 7s6.1 3 6.1 7.6c0 2-.3 3.9-.6 5.4" />
      <circle cx="6.6" cy="10.5" r=".5" fill="currentColor" /><circle cx="17.4" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="5.6" cy="14.5" r=".5" fill="currentColor" /><circle cx="18.4" cy="14.5" r=".5" fill="currentColor" />
    </svg>
  );
}
export function RacesIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
      <path d="M8 4h8v4.5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 6H5.5a2.5 2.5 0 0 0 2.6 3.2M16 6h2.5a2.5 2.5 0 0 1-2.6 3.2M12 12.5V16m-3.5 4h7l-.8-4h-5.4l-.8 4Z" />
    </svg>
  );
}
export function ClockIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
      <circle cx="12" cy="13" r="7.5" /><path d="M12 9v4l2.5 2M10 3h4M12 3v2.5" />
    </svg>
  );
}
export function ShieldIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
      <path d="M12 3 5 6v5.5c0 4.2 2.9 7.9 7 9.5 4.1-1.6 7-5.3 7-9.5V6l-7-3Z" /><path d="m9 12 2 2 4-4" />
    </svg>
  );
}
export function ArrowIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </svg>
  );
}
export function CoinIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
      <circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5.5" /><path d="M12 9.5v5" />
    </svg>
  );
}

/** The club crest: a horseshoe in a roundel. */
export function Crest({ className }: P) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <linearGradient id="crest-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0d68e" /><stop offset="1" stopColor="#b88f3a" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="18.5" fill="#0e2319" stroke="url(#crest-g)" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="15" fill="none" stroke="#c9a24a" strokeOpacity=".3" strokeWidth=".75" />
      <path d="M13.2 28.5c-1-2.4-1.7-5-1.7-7.6 0-5.3 3.8-9.4 8.5-9.4s8.5 4.1 8.5 9.4c0 2.6-.7 5.2-1.7 7.6h-2.6c.8-2.2 1.3-4.6 1.3-7 0-3.8-2.4-6.6-5.5-6.6s-5.5 2.8-5.5 6.6c0 2.4.5 4.8 1.3 7h-2.6Z" fill="url(#crest-g)" />
    </svg>
  );
}
