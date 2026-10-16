"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

export function Button({ children, href = "#demo", variant = "primary", className = "" }: { children: ReactNode; href?: string; variant?: "primary" | "secondary" | "ghost"; className?: string }) {
  const styles = {
    primary: "bg-ink text-white hover:bg-black shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_6px_16px_-6px_rgba(0,0,0,0.45)]",
    secondary: "bg-[#ebe9e4] text-ink hover:bg-[#e3e0da]",
    ghost: "text-ink hover:bg-black/5",
  }[variant];
  return (
    <a
      href={href}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold tracking-[-0.01em] transition-[background,transform] duration-300 active:scale-[0.98] ${styles} ${className}`}
      style={{ fontFamily: "var(--font-display)" }}
    >
      {children}
    </a>
  );
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-[12.5px] font-semibold text-ink-2 shadow-[0_1px_2px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.06] ${className}`}>
      {children}
    </div>
  );
}

const reveal = {
  initial: { opacity: 0, y: 24, filter: "blur(6px)" },
  whileInView: { opacity: 1, y: 0, filter: "blur(0px)" },
  viewport: { once: true, margin: "-12% 0px -12% 0px" },
};

export function SectionHead({
  title,
  second,
  sub,
  align = "center",
  className = "",
}: {
  title: ReactNode;
  second?: ReactNode;
  sub?: ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div className={`${align === "center" ? "mx-auto text-center" : ""} max-w-[760px] ${className}`}>
      <motion.h2 {...reveal} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} className="h-section text-[clamp(34px,4.6vw,56px)] text-ink">
        {title}
        {second && (
          <>
            <br />
            <span className="text-second">{second}</span>
          </>
        )}
      </motion.h2>
      {sub && (
        <motion.p
          {...reveal}
          transition={{ duration: 0.9, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
          className={`mt-5 text-[17px] leading-[1.55] text-muted md:text-[18.5px] ${align === "center" ? "mx-auto" : ""} max-w-[600px]`}
        >
          {sub}
        </motion.p>
      )}
    </div>
  );
}

export function Reveal({ children, delay = 0, className = "", y = 24 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-10% 0px -10% 0px" }}
      transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[22px] bg-white shadow-[var(--shadow-card)] ring-1 ring-black/[0.05] ${className}`}>{children}</div>;
}

export function RuntimeBadge({ runtime }: { runtime?: string }) {
  if (!runtime) return null;
  const cc = runtime === "Claude Code";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-semibold ${cc ? "bg-[#fbe9de] text-[#a24d1f]" : "bg-[#e8eefb] text-[#2c56b0]"}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cc ? "bg-[#e8743b]" : "bg-[#3b7be8]"}`} />
      {runtime}
    </span>
  );
}
