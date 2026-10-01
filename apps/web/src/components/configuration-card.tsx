import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

type ConfigurationCardProps = {
  title: string;
  description: string;
  icon: ReactNode;
  href: string;
  children?: ReactNode;
  status?: ReactNode;
  wide?: boolean;
  disabled?: boolean;
};

export function ConfigurationCard({ title, description, icon, href, children, status, wide = false, disabled = false }: ConfigurationCardProps) {
  return <article className={`setup-summary-card${wide ? " wide" : ""}${disabled ? " disabled" : ""}`}>
    {disabled ? <div className="setup-summary-link" aria-disabled="true">
      <span className="setup-summary-icon" aria-hidden="true">{icon}</span><span className="setup-summary-heading"><span>{title}</span><small>{description}</small></span>{status}
    </div> : <Link className="setup-summary-link" href={href} aria-label={title}>
      <span className="setup-summary-icon" aria-hidden="true">{icon}</span><span className="setup-summary-heading"><span>{title}</span><small>{description}</small></span>{status}<ChevronRight className="setup-summary-chevron" aria-hidden="true"/>
    </Link>}
    {children && <div className="setup-summary-body">{children}</div>}
  </article>;
}
