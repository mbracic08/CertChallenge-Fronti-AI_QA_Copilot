"use client";

export interface AnimatedBackgroundProps {
  className?: string;
}

export function AnimatedBackground({ className }: AnimatedBackgroundProps) {
  return (
    <div aria-hidden="true" className={`pointer-events-none fixed inset-0 z-0 ${className ?? ""}`}>
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/images/fronti-network-bg.jpg')" }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(226,0,116,0.12)_0%,rgba(8,4,14,0.68)_55%,rgba(2,2,6,0.88)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,2,8,0.42)_0%,rgba(4,2,8,0.62)_100%)]" />
    </div>
  );
}
