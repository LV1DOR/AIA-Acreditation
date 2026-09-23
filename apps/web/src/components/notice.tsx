import type { ReactNode } from "react";
export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return <section className="notice"><span className="notice-icon" aria-hidden="true">!</span><div><h2>{title}</h2><div>{children}</div></div></section>;
}

