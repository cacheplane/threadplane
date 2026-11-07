/** Monochrome framework marks, inheriting the website's brand color. */
export function ReactMark() {
  return (
    <svg width="28" height="28" viewBox="-12 -12 24 24" fill="none" aria-hidden="true">
      <circle r="2" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1">
        <ellipse rx="11" ry="4.2" />
        <ellipse rx="11" ry="4.2" transform="rotate(60)" />
        <ellipse rx="11" ry="4.2" transform="rotate(120)" />
      </g>
    </svg>
  );
}

/** Angular's current mark, matching the LLA family website treatment. */
export function AngularMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 96 100" fill="currentColor" aria-hidden="true">
      <path d="M59.2297 0L91.8649 70.2297L95.2568 16.6622L59.2297 0Z" />
      <path d="M67.6487 73.7973H28.3784L23.3649 85.9459L48.0135 100L72.6622 85.9459L67.6487 73.7973Z" />
      <path d="M35.1082 58.0405H60.9325L48.0136 26.6487L35.1082 58.0405Z" />
      <path d="M36.7973 0L0.770264 16.6622L4.16216 70.2297L36.7973 0Z" />
    </svg>
  );
}
