// Decorative "who's going" stack — deliberately abstract (initials on a
// gradient circle), never a real attendee's photo. We only have a sold
// count at the card level, not individual attendee avatars, so faking real
// human photos here would be fabricated social proof. This gives the same
// visual weight (overlapping circles + a count) without claiming anything
// untrue about who's actually attending.
const PALETTE = ["#7B6EF6", "#4A8DFF", "#F97316", "#16A34A", "#EC4899"];

function hueFor(seed: string, i: number): string {
  let h = 0;
  for (let j = 0; j < seed.length; j++) h = (h * 31 + seed.charCodeAt(j)) % 997;
  return PALETTE[(h + i) % PALETTE.length];
}

export default function AvatarStack({ seed, count, size = 22 }: { seed: string; count: number; size?: number }) {
  if (count <= 0) return null;
  const dots = Math.min(3, count);
  const label = count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k going` : `${count} going`;
  return (
    <div className="avatar-stack">
      {Array.from({ length: dots }).map((_, i) => (
        <span key={i} className="avatar-dot" style={{ width: size, height: size, background: hueFor(seed, i), zIndex: dots - i }} />
      ))}
      <span className="avatar-stack-label">{label}</span>
    </div>
  );
}
