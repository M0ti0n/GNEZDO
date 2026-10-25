// GNEZDO app icon: nest with a bird tucked inside (same drawing as public/gnezdo.svg).
export function GnezdoIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="140 40 400 400" aria-hidden="true">
      <defs>
        <clipPath id="gnezdo-lip">
          <path d="M 140 40 L 540 40 L 540 238 L 480 238 Q 340 296 200 238 L 140 238 Z" />
        </clipPath>
      </defs>
      <rect x="140" y="40" width="400" height="400" rx="88" fill="#FCFCFB" />
      <g fill="none" stroke="#0B0B0B" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 205 235 C 240 345, 440 345, 475 235" />
        <path d="M 215 215 C 255 310, 430 335, 500 262" />
        <path d="M 180 262 C 250 335, 420 318, 468 210" />
        <path d="M 238 285 C 290 335, 395 338, 445 282" />
        <path d="M 172 205 L 222 240" />
        <path d="M 510 200 L 462 238" />
      </g>
      <g clipPath="url(#gnezdo-lip)">
        <g transform="translate(0,32)">
          <path
            d="M 250 172 L 274 158 C 280 132, 315 125, 335 145 C 365 168, 425 188, 488 162 L 468 196 C 440 228, 400 244, 340 246 C 288 246, 258 218, 272 186 Z"
            fill="#0B0B0B" stroke="#FCFCFB" strokeWidth="9" strokeLinejoin="round" paintOrder="stroke" />
          <circle cx="298" cy="158" r="5" fill="#FCFCFB" />
        </g>
      </g>
      <path d="M 200 238 Q 340 296 480 238" fill="none" stroke="#FCFCFB" strokeWidth="23" strokeLinecap="round" />
      <path d="M 200 238 Q 340 296 480 238" fill="none" stroke="#0B0B0B" strokeWidth="11" strokeLinecap="round" />
    </svg>
  );
}
