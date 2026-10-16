export function LogoMark({ size = 28 }: { size?: number }) {
  // A tiny pixel floor plan: four rooms, one lit.
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" style={{ shapeRendering: "crispEdges" }} aria-hidden>
      <rect width="28" height="28" rx="8" fill="#0a0a0a" />
      <rect x="6" y="6" width="7" height="7" fill="#e8743b" />
      <rect x="15" y="6" width="7" height="7" fill="#ffffff" fillOpacity="0.92" />
      <rect x="6" y="15" width="7" height="7" fill="#ffffff" fillOpacity="0.92" />
      <rect x="15" y="15" width="7" height="7" fill="#ffffff" fillOpacity="0.35" />
    </svg>
  );
}

export function Logo() {
  return (
    <a href="#top" className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[22px] font-medium tracking-[-0.02em] text-ink" style={{ fontFamily: "var(--font-serif)" }}>
        FloorPlan
      </span>
    </a>
  );
}
