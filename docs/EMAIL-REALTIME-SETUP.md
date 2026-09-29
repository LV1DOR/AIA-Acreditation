# Email, notifications and realtime setup

Phase 7 keeps SMTP as the active transport. Resend is reserved for a future, separately reviewed cutover after domain purchase and verification. Do not configure Postmark.

## Local services

`corepack pnpm infra:up` starts Mailpit SMTP on `127.0.0.1:11025`, its inbox on `http://127.0.0.1:18025`, and Redis on `127.0.0.1:16379`. The checked-in `.env.example` already points to those loopback services. Keep Clerk and encryption values in the ignored `.env`; never commit them.

Apply migrations to both development and isolated test databases before starting processes. Then run the web and worker in separate terminals:

```powershell
corepack pnpm dev
corepack pnpm dev:worker
```

The worker readiness endpoint is `http://127.0.0.1:3102/api/health/ready`. It returns ready only while PostgreSQL and Redis are reachable. Mailpit acceptance is verified through the test suite and inbox; the health endpoint does not send probe email.

## Delivery behaviour

- Workflow mutations insert notification/outbox intent in the same serializable PostgreSQL transaction.
- Clerk and leader-invitation bodies remain encrypted until SMTP delivery.
- Business email payloads identify an internal user; the worker resolves a verified Clerk email at delivery time.
- Email jobs use a one-minute lease, exponential retry delay capped at five minutes, and eight attempts.
- `EmailDelivery` records queued/retrying/sent/failed state without storing the recipient address.
- SMTP delivery is at-least-once because a process can fail after provider acceptance but before the database acknowledgement.

The bilingual templates cover submission receipt/decision, request receipt/decision, urgent replacement and deadline reminders. Reminder jobs are deduplicated for 7, 3 and 1 days before onboarding closes.

## Realtime behaviour

The worker consumes durable `DOMAIN_INVALIDATION` rows and publishes a privacy-minimised event to `aia:acreditacao:portal-invalidation`. An authenticated `/api/realtime` SSE connection receives that event and refreshes the current server-rendered portal data. The stream does not transmit company, event, participant, request or submission identifiers.

Redis outage never changes business state. Pending invalidations retry from PostgreSQL, normal navigation still reads PostgreSQL, and the SSE endpoint returns unavailable instead of silently creating an unauthorised fallback.

## Production gate

Production remains unauthorised. Before a future deployment, configure a verified SMTP sender and SPF/DKIM/DMARC, use the production HTTPS origin, keep Redis private, disable reverse-proxy buffering for SSE, and validate reconnect, retry and multi-instance Pub/Sub behaviour. Repeat the full test/build/audit suite and record real provider evidence using non-personal synthetic recipients.
