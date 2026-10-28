/** The MetaMask fox at 20 px. The official logo SVG is ~10 KB, so this is a low-poly cut (well under the 2 KB icon budget) on its palette. */
export function MetaMaskFox({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className={className} xmlns="http://www.w3.org/2000/svg">
      {/* ears first: the head covers their base */}
      <polygon points="1.5,1 6.5,2.2 5,7.5" fill="#e2761b" />
      <polygon points="2.4,2 5.6,2.9 4.7,6.1" fill="#a0490b" />
      <polygon points="18.5,1 13.5,2.2 15,7.5" fill="#e2761b" />
      <polygon points="17.6,2 14.4,2.9 15.3,6.1" fill="#a0490b" />
      <polygon points="4.5,2.5 15.5,2.5 17.5,8.5 10,19 2.5,8.5" fill="#e2761b" />
      <polygon points="2.5,8.5 6,10.5 10,19" fill="#c96c11" />
      <polygon points="17.5,8.5 14,10.5 10,19" fill="#c96c11" />
      <polygon points="6.3,10.7 13.7,10.7 12.4,13.2 10,16.3 7.6,13.2" fill="#c0ad9f" />
      <circle cx="7" cy="8.6" r="0.95" fill="#161616" />
      <circle cx="13" cy="8.6" r="0.95" fill="#161616" />
      <polygon points="9,14.3 11,14.3 10,15.7" fill="#161616" />
    </svg>
  );
}