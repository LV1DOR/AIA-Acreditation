"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";

export function EmailTableViewport({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const region = ref.current;
    if (!region) return;
    const resize = () => {
      const header = region.querySelector("thead")?.getBoundingClientRect().height ?? 30;
      const minimum = Number.parseFloat(getComputedStyle(region).getPropertyValue("--email-min-row-height")) || 26;
      const count = region.querySelectorAll("tbody tr").length;
      const height = count < 15 ? Math.max(minimum, 44) : Math.max(minimum, Math.floor((region.clientHeight - header) / 15));
      region.style.setProperty("--email-row-height", `${height}px`);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(region);
    resize();
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className="table-scroll" tabIndex={0} role="region" aria-label={label}>{children}</div>;
}
