// The canonical mdbase Frontmatter mark (geometry from mdbase-connect/assets)
// with the live-type wordmark.
const inkRects = [
  { x: 22, y: 22, width: 20, height: 10 },
  { x: 50, y: 22, width: 20, height: 10 },
  { x: 78, y: 22, width: 20, height: 10 },
  { x: 22, y: 44, width: 12, height: 10 },
  { x: 22, y: 66, width: 28, height: 10 },
  { x: 58, y: 66, width: 40, height: 10 },
  { x: 22, y: 88, width: 20, height: 10 },
  { x: 50, y: 88, width: 20, height: 10 },
  { x: 78, y: 88, width: 20, height: 10 },
] as const;

export function MdbaseMark({ className }: { className?: string }) {
  return (
    <svg viewBox="18 18 84 84" aria-hidden="true" className={className}>
      <g className="mark-ink">
        {inkRects.map((r) => (
          <rect key={`${r.x}-${r.y}`} {...r} rx="2" />
        ))}
      </g>
      <rect className="mark-accent" x="42" y="44" width="56" height="10" rx="2" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <MdbaseMark className="mark" />
      <strong>mdbase</strong>
      <span>writer</span>
    </span>
  );
}
