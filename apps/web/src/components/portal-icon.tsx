import type { ReactNode } from "react";
import { AccountFileTextOutlineIcon } from "./icons/mdi-account-file-text-outline.tsx";
import { AccountGroupOutlineIcon } from "./icons/mdi-account-group-outline.tsx";
import { FileDocumentArrowRightOutlineIcon } from "./icons/mdi-file-document-arrow-right-outline.tsx";

export type IconName = "home" | "people" | "finalSubmission" | "requests" | "document" | "car" | "bell" | "help" | "info" | "calendar" | "pin" | "clock" | "alert" | "check" | "arrow" | "settings" | "id" | "briefcase" | "building" | "camera" | "shield" | "back";

export function PortalIcon({ name, size = 22 }: { name: IconName; size?: number }) {
  if (name === "people") return <AccountGroupOutlineIcon aria-hidden="true" size={size}/>;
  if (name === "finalSubmission") return <FileDocumentArrowRightOutlineIcon aria-hidden="true" size={size}/>;
  if (name === "requests") return <AccountFileTextOutlineIcon aria-hidden="true" size={size}/>;

  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<Exclude<IconName, "people" | "finalSubmission" | "requests">, ReactNode> = {
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10M9 21v-7h6v7"/></>,
    document: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></>,
    car: <><path d="m5 11 2-5h10l2 5M4 11h16v7H4z"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.5 2.5 0 1 1 3.8 2.1c-1.1.7-1.5 1.2-1.5 2.4M12 17.5h.01"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>,
    alert: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></>,
    check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
    arrow: <><path d="m9 18 6-6-6-6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    id: <><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M5.5 16c.6-1.7 4.4-1.7 5 0M13 10h5M13 14h5"/></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 12h18M10 12v2h4v-2"/></>,
    building: <><path d="M5 21V4h10v17M15 9h4v12M3 21h18M8 8h4M8 12h4M8 16h4"/></>,
    camera: <><path d="M4 7h4l1.5-2h5L16 7h4v13H4z"/><circle cx="12" cy="13" r="4"/></>,
    shield: <><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/><path d="m9 12 2 2 4-4"/></>,
    back: <><path d="m15 18-6-6 6-6M9 12h11"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} {...common}>{paths[name]}</svg>;
}
