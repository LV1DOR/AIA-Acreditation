# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- AIA accreditation administrators configure events, companies, access rules and catalogues, then review company submissions and operational requests.
- Invited company leaders configure their company participation, manage workers and vehicle or zone requests, and submit the final accreditation package for AIA review.
- Workers use a secure, one-time link to provide only the personal information required for their accreditation.

## Product Purpose

AIA Acreditação coordinates event workforce accreditation between AIA, participating companies and their workers. Success means each event reaches a complete, reviewable and traceable final submission while every role sees a clear next action and only the information it is authorised to access.

## Positioning

The product combines invite-only company access, company-scoped workforce preparation, individual one-time worker onboarding and an immutable AIA review workflow in one bilingual operational portal.

## Operating Context

- The interface is used before and during motorsport-event preparation, primarily by office-based AIA staff and company leaders managing time-sensitive accreditation work.
- Portuguese and English are first-class interface languages; a selected locale must not display duplicate translations.
- Email is delivered through the current SMTP worker transport. Resend remains the planned future provider after a domain is available; Postmark is out of scope.
- PostgreSQL and the domain services are the source of truth for roles, memberships, registrations, submissions, requests and notifications.

## Capabilities and Constraints

- Company leaders are invite-only and may never self-assign themselves to a company.
- Company access is isolated by server-side membership checks.
- Invitations are email-matched, hashed at rest, one-time and expiry-bound.
- Administrators review submitted people individually before completing a final submission decision.
- Returned corrections must identify the affected worker or operational area and take the leader directly to the relevant correction.
- Submission and request state machines are system-controlled; users should not select internal lifecycle states manually.
- Authentication and account management use Clerk, while application authorisation remains in PostgreSQL.
- No production deployment or infrastructure mutation is implied by local product work.

## Brand Commitments

- Product name: AIA Acreditação.
- Preserve the existing AIA identity, supplied logos and motorsport context.
- Interfaces should feel precise, operational and calm, with AIA red reserved for meaningful emphasis and action.
- Reusable components should provide consistent behavior for equivalent actions and states across administrator and company-leader surfaces.

## Evidence on Hand

- `AIA_ACREDITACAO_CODEX_HANDOFF_v2.md` is the implementation source of truth.
- Existing application routes, domain tests and Playwright acceptance tests document working role and workflow behavior.
- User-supplied UI references in the project conversation are binding references for the relevant portal surfaces.
- Production legal copy, final privacy notice and production-readiness evidence remain explicitly unresolved where documented by the handoff.

## Product Principles

1. Make the next operational action obvious without exposing implementation terminology.
2. Preserve strict role and company isolation even when simplifying the interface.
3. Reuse one interaction pattern for one job throughout the product.
4. Show specific, human-readable state and feedback instead of generic system messages.
5. Keep bilingual behavior complete while showing only the active language.

## Accessibility & Inclusion

- All primary workflows must work with keyboard navigation, visible focus, semantic controls and reduced motion.
- Responsive behavior must support common desktop widths and mobile worker onboarding without clipped or overlapping controls.
