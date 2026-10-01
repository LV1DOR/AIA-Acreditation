---
name: AIA Acreditação
description: A precise operational interface for event accreditation.
colors:
  aia-crimson: "#cd1b30"
  ink: "#191b20"
  muted: "#626770"
  paper: "#f5f5f2"
  surface: "#ffffff"
  border: "#e1e3e6"
  success-soft: "#e7f3ea"
  warning-soft: "#fff1d7"
  danger-soft: "#fde7eb"
rounded:
  control: "6px"
  surface: "8px"
  overlay: "10px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.aia-crimson}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "14px 22px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "14px 22px"
    height: "48px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "24px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 11px"
    height: "44px"
---

# Design System: AIA Acreditação

## Overview

**Creative North Star: "The Accreditation Control Room"**

The interface is a calm operational workspace shaped by AIA's motorsport identity. It uses disciplined white surfaces, charcoal structure and small, meaningful doses of AIA red so administrators and company leaders can understand status and take the next action quickly.

Information density is deliberate: related facts stay together, repeated actions share one component, and workflow language remains human rather than technical. Visual hierarchy comes from scale, spacing, borders and clear status treatment instead of decoration.

**Key Characteristics:**

- Precise, operational and calm.
- White working surfaces on a soft neutral field.
- AIA red reserved for action, urgency and active navigation.
- Compact line icons and concise, locale-specific copy.
- Responsive layouts that simplify without hiding required information.

## Colors

The palette combines AIA crimson with near-black structure and cool neutral working surfaces.

### Primary

- **AIA Crimson:** the principal action and emphasis color, used for primary buttons, active states and urgent indicators.

### Neutral

- **Operational Ink:** headings, primary copy and dark navigation surfaces.
- **Quiet Grey:** supporting copy and timestamps.
- **Track Paper:** the application background behind cards and forms.
- **White Surface:** cards, fields, headers and overlays.
- **Technical Border:** dividers and control outlines.

### Named Rules

**The Red Means Something Rule.** Red marks a primary action, active location or item requiring attention; it is not general decoration.

**The One Locale Rule.** A screen shows Portuguese or English, never both versions of the same label at once.

## Typography

The incumbent application uses a compact sans-serif hierarchy. The current Arial stack is implementation drift, not a durable brand token; do not expand it into a more expressive display system until AIA approves a brand typeface.

### Hierarchy

- **Display** (700–750, 30–36px, 1.15): page titles and major event names.
- **Title** (700, 18–20px, 1.3): cards and workflow sections.
- **Body** (400–600, 13–15px, 1.4–1.6): instructions and operational content.
- **Label** (700–800, 9–12px): compact metadata, statuses and controls; uppercase is limited to established brand or navigation labels.

## Layout

Desktop portals use a shared 300px sidebar, a global header and a centred content region. Content is grouped into bordered cards with an 8–24px internal rhythm; larger page gaps use 24–40px. Forms use responsive grids and collapse to one column when space is limited.

At mobile widths, the portal stacks vertically. Navigation becomes one horizontal, scrollable row; overlays fit within the viewport; list rows preserve their icon, core message and destination while secondary spacing contracts.

## Elevation & Depth

The system is flat by default. Borders and tonal separation establish structure; soft ambient shadows are reserved for floating overlays and select raised cards.

### Shadow Vocabulary

- **Overlay:** a broad, low-opacity shadow for menus and modal surfaces.
- **Ambient card:** a very light shadow used only where a card must separate from an already pale background.

**The Flat-by-Default Rule.** A normal card needs a border, not a shadow. Elevation communicates stacking or temporary focus.

## Shapes

Controls use compact 5–6px corners, working surfaces use 7–10px corners, and counters or statuses use full pills. Circular shapes are reserved for avatars, icon wells, unread dots and status markers.

## Components

### Buttons

- **Shape:** compact rounded rectangle with a 48px primary height.
- **Primary:** AIA crimson, white text and a darker red hover state.
- **Secondary:** white surface with a neutral border and subtle grey hover.
- **Focus:** a visible red focus ring outside the control.

### Cards / Containers

- **Corner Style:** gently rounded working surface.
- **Background:** white on Track Paper.
- **Shadow Strategy:** flat by default; overlays receive ambient depth.
- **Border:** one-pixel Technical Border.
- **Internal Padding:** normally 18–26px, reduced on mobile.

### Inputs / Fields

- **Style:** white field, neutral one-pixel border, 44px minimum height.
- **Focus:** stronger border plus a visible focus treatment.
- **Error / Disabled:** error copy uses danger red; disabled controls visibly reduce emphasis and block interaction.

### Navigation

Administrator and company-leader portals use the same charcoal rail. The supplied AIA architecture image is anchored to the bottom and fades smoothly into the solid upper surface, keeping navigation quiet and readable. The transparent AIA logo sits directly on the charcoal surface in a high-contrast monochrome treatment; inactive destinations remain white, and the selected destination uses one solid crimson surface. Both roles share the same navigation renderer, icon-and-label rhythm and responsive horizontal treatment. Account and notifications live only in the global header.

### Notifications

The bell, compact dropdown and full history page share one notification-row component. Every row names the change, its company or event context, its time and a direct destination. The badge uses crisp tabular numerals and appears only when unread items exist. Opening the menu never changes read state: a notification becomes read when selected, while an explicit action marks all notifications read. Motion respects reduced-motion preferences.

### Event Setup

Event setup uses two related surfaces. The default view is an event-focused control page with one compact event summary, operational counts and direct management cards. Creating or completing an event uses a four-step sequence: Event, Catalogues, Companies and Review. Each step persists real domain data, keeps draft and publication states system-controlled, and provides a single clear forward action.

The wizard uses one coordinated date-picker layer so only one calendar can be open at a time. At narrower desktop widths, event metrics move beneath the event summary rather than clipping; mobile stacks the same information without hiding any required action.

## Do's and Don'ts

### Do:

- **Do** reuse the same component for the same interaction across roles and routes.
- **Do** make the next operational action obvious and link notifications to the relevant workflow.
- **Do** use icons from the established stroke vocabulary with accessible labels on controls.
- **Do** validate desktop and mobile layouts whenever a global shell component changes.

### Don't:

- **Don't** expose database identifiers, hashes, enum values or immutable-version terminology to operators.
- **Don't** duplicate Portuguese and English copy on the same selected-locale screen.
- **Don't** add sidebar destinations for account or notifications; they belong in the global header.
- **Don't** create one-off variants when an existing reusable pattern performs the same job.
