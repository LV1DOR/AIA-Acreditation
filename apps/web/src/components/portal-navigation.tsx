"use client";

import Link from "next/link";
import type { IconName } from "./portal-icon.tsx";
import { PortalIcon } from "./portal-icon.tsx";

export type PortalNavigationItem = {
  href?: string;
  icon: IconName;
  label: string;
  active: boolean;
  unavailableLabel?: string;
};
export type PortalNavigationSection = { label: string; items: PortalNavigationItem[] };

function NavigationItems({ items }: { items: PortalNavigationItem[] }) {
  return <>{items.map(item => item.href
    ? <Link key={`${item.label}-${item.href}`} href={item.href} className={item.active ? "active" : undefined} aria-current={item.active ? "page" : undefined}>
      <PortalIcon name={item.icon}/><span>{item.label}</span>
    </Link>
    : <span key={item.label} className="nav-disabled" aria-disabled="true" title={item.unavailableLabel}>
      <PortalIcon name={item.icon}/><span>{item.label}</span>
    </span>)}</>;
}

export function PortalNavigation({ label, items, sections }: { label: string; items?: PortalNavigationItem[]; sections?: PortalNavigationSection[] }) {
  return <nav className="portal-nav" aria-label={label}>{sections
    ? sections.map(section => <div className="portal-nav-group" key={section.label}><p>{section.label}</p><NavigationItems items={section.items}/></div>)
    : <NavigationItems items={items ?? []}/>}</nav>;
}
