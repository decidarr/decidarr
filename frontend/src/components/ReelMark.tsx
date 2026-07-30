// The brand mark ("Reel Roulette" — a film reel that reads as a roulette
// wheel, from assets/logo.svg) re-tinted for the plum room via CSS
// variables, so it follows the palette instead of hard-coding v1's ink.
// "full" is the coloured mark; "outline" is a single-colour cream
// silhouette for watermark use. Decorative in every placement — always
// aria-hidden, with the meaning carried by adjacent text.

const HOLES = [
  { cx: 256, cy: 152 },
  { cx: 355, cy: 209 },
  { cx: 355, cy: 323 },
  { cx: 256, cy: 380 },
  { cx: 157, cy: 323 },
  { cx: 157, cy: 209 },
];

const POINTER = "M 230 10 L 282 10 L 256 62 Z";

export function ReelMark({
  size = 72,
  variant = "full",
  className,
}: {
  size?: number;
  variant?: "full" | "outline";
  className?: string;
}) {
  const outline = variant === "outline";
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <circle
        cx="256"
        cy="266"
        r="186"
        fill={outline ? "none" : "var(--panel)"}
        stroke={outline ? "var(--cream)" : "var(--gold)"}
        strokeWidth="16"
      />
      <g fill={outline ? "var(--cream)" : "var(--ink)"}>
        {HOLES.map((h) => (
          <circle key={`${h.cx}-${h.cy}`} cx={h.cx} cy={h.cy} r="44" />
        ))}
      </g>
      {/* the lucky pocket — the wheel has already picked one */}
      {!outline && <circle cx="355" cy="209" r="30" fill="var(--green)" />}
      <circle cx="256" cy="266" r="40" fill={outline ? "var(--cream)" : "var(--gold)"} />
      {!outline && <circle cx="256" cy="266" r="14" fill="var(--ink)" />}
      <path d={POINTER} fill={outline ? "var(--cream)" : "var(--gold)"} />
    </svg>
  );
}
