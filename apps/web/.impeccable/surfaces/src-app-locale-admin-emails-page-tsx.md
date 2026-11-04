# Email monitoring

Mode: Operate. A precise extension of the established Admin portal.

## Direction contract

THESIS: Help authorised administrators investigate one system email by recipient, company, event and delivery evidence. Distinguish sending state from observed provider outcomes.

OWN-WORLD: Preserve DESIGN.md and the current charcoal navigation, white workspace, crimson navigation accent, shared table styling, neutral borders and compact status labels. No new visual identity or assets.

STORY: Type part of a name/address or subject with typo tolerance, narrow immediately by status, open the message, and compare event time with receipt time. Explain missing visibility without inventing delivery evidence. Full addresses are authorised by the user's explicit preference.

FIRST VIEWPORT: Emails heading and labelled filters precede four primary columns: To, Status, Subject and Date. Clicking a row opens plain-language email events with expandable provider and SMTP responses. Context/IDs remain under a detail disclosure. The user-requested provider selector, tracking-help disclosure and Filter button are absent. The list uses a fixed viewport with 15 compact rows and persistent newer/older controls. Mobile keeps the table in a bounded, labelled keyboard-accessible scroll region. The detail uses the requested REUI c-timeline-3 pattern with colour-coded icons and Lisbon date/time including seconds. This hierarchy follows the user's Resend screenshots and explicit 4 November simplification request.

FORM: Precisely specified Admin extension; code-led, no concept seed. A dedicated read-only timeline is the signature interaction. PT and EN each show only their selected translation. No sending, retry, deletion or settings controls.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Evidence boundary

Screenshots use synthetic local records and Clerk development accounts. A separately authorised single real-email test from `notify.joinaia.pt` persisted signed SENT and DELIVERED events through a localtunnel endpoint. That test establishes the observed local send/webhook path; production readiness and Nicole's account remain outside this implementation's validation.

## Previous search-refinement verification

Verified on 2026-11-04 as an ordinary, code-led refinement of the established Admin interface. Compared `email-monitoring.tsx`, `email-monitor-filters.tsx` and the six final email screenshots with `DESIGN.md`, `apps/web/PRODUCT.md` and this contract. The implementation inherits the charcoal shell, crimson active destination and focus treatment, bordered white table, compact semantic status pills and selected-locale copy. The requested About email tracking / Sobre o acompanhamento disclosure, Provider / Fornecedor selector and Filter / Filtrar button are absent. Search applies automatically after a 250ms debounce for fragment and fuzzy matching; status selection applies immediately. Refresh and Clear filters remain available. Mobile stacks filters and detail facts; the list retains its labelled, keyboard-accessible horizontal scroll region. Full recipient addresses and expandable provider identifiers support the explicitly authorised ADMIN investigation task; the surface has no send, retry, delete or configuration controls.

Visually inspected all six final recaptures taken after 13:34 under the project-root `.impeccable/review/resend-monitoring/`: `en-desktop.png`, `en-mobile.png`, `pt-desktop.png`, `pt-mobile.png`, `detail-desktop.png` and `detail-mobile.png`. The captures include the top of each page. The detail captures show a synthetic bounce, its plain-language explanation and expanded provider message plus actual-format SMTP diagnostics; they do not demonstrate multiple provider identities. The finish reviewer returned **ship** with no material fixes. `search-detector.json` contains no findings (`[]`). The implementation run reports 248 unit tests, 15 targeted integration tests, typecheck, lint and three browser tests including Clerk setup passed; the documentation pass did not rerun them. This records the local refinement's evidence and review scope, not production readiness.

`DESIGN.md`, `.impeccable/design.json` and `apps/web/PRODUCT.md` are preserved. Existing Arial/typeface drift and the product brief's SMTP-now/Resend-future history remain untouched; this narrow refinement introduces no new identity. Screenshot evidence remains local and synthetic, distinct from the separately authorised live-email result above. Production infrastructure, production readiness and Nicole's account remain unverified.

## Fifteen-message layout and REUI timeline verification

Compared the finished source and six current screenshots with DESIGN.md and PRODUCT.md. This remains an ordinary extension: preserve DESIGN.md, design.json and PRODUCT.md. List pages show15 records with older/newer anchors preserving search/status. Full pages divide the measured table height across15 rows, with no48px upper cap; the latest user-supplied tall-screen screenshot prompted that correction. Text scales within12–15px and badges within11–13px. Partial pages keep pagination directly below the actual rows. The per-page text is absent. Desktop test assertions verify all15 rows fit and the last-row gap is under17px at1440×1400,1440×900 and1280×800; the page itself does not scroll. Mobile retains bounded inner-table scrolling and visible pagination. Details use the installed REUI c-timeline-3 pattern with real status icons/colours and Lisbon event/receipt times including seconds. Escaped technical messages remain expandable.

The independent finish-review agent hit the account usage limit; the final review and documentation were substituted inline. The local review returned ship at this scope, with no material fixes outstanding; see project-root .impeccable/review/resend-monitoring/pagination-timeline-review.md. It reviewed the user's gap screenshot, current source, selected-language list captures and REUI detail captures. The once-per-cycle detector found396 baseline/global findings and none in the new components/new CSS region; no further detector was run. Existing typeface/brief drift is preserved and not canonised. Production launch and Nicole's account remain outside local verification.