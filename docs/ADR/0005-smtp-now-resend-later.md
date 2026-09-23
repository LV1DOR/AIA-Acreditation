# ADR 0005: SMTP now, Resend later
Accepted by direct user instruction, 21 September 2026.
This supersedes all Postmark references in the supplied handoff.

EmailTransport isolates delivery from domain services and React Email templates.
Current adapter: SMTP with environment credentials; local delivery uses Mailpit.
Future adapter: Resend after domain purchase and verification.
Do not choose the provider by detecting whether a domain happens to exist. Cutover is explicit configuration.
Business notifications remain bilingual PT-PT/EN. Employees receive no workflow emails.
Workflow email templates and durable delivery processing are scheduled for Phase 7; the transport is independently tested now.

