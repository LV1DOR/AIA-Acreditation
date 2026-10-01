---
version: 1
slug: "src-app-locale-notifications-page-tsx"
primary_target: "src/components/notifications-page.tsx"
related_targets: ["src/app/[locale]/admin/notifications/page.tsx","src/app/[locale]/company/notifications/page.tsx","src/components/notification-menu.tsx","src/components/notification-item.tsx"]
---

# Notifications surface

Mode: Operate

Audience: authenticated AIA administrators and company leaders checking recent operational changes. Task: understand what happened, where it happened and whether action is needed, then navigate directly to the relevant workflow. Constraints: one active locale, no technical identifiers or enum labels, membership-safe destinations, and the established AIA portal shell.

## Direction contract

THESIS: Notifications are a concise operational timeline, not a generic inbox or a second dashboard. It refuses anonymous “something changed” copy.

OWN-WORLD: Extend the incumbent white, charcoal and AIA-red portal system with restrained status color, crisp separators and the existing icon vocabulary. Equivalent notification rows share one component in the dropdown and full page.

STORY: The user immediately sees what changed, the company or event concerned, when it happened and the destination that resolves it.

FIRST VIEWPORT: The global bell opens a compact recent-notifications panel with unread state and a clear “view all” footer. The full page opens with unread and total counts, followed by a spacious chronological list whose entire rows are navigable.

FORM: Focused extension of the established Operate surface; no new visual-world roll is needed because the interaction and surrounding shell are already fixed by the brief.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Review captures: `.impeccable/review/notifications-desktop.png` and `.impeccable/review/notifications-mobile.png`.
