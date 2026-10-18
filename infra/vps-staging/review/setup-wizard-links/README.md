Authorized deployment is now packaged in [DEPLOY.md](DEPLOY.md). Run the scoped `wizard_release.py deploy` operator command there; the permanent application fix remains pending its execution in normal PuTTY.

Confirmed Catalogues → Review navigation bug.

`SetupWizard` builds `base` with `eventId` and `created=1`. The Catalogues Continue link appends the same `eventId` again. Next.js represents repeated search parameters as arrays, as documented in the [page searchParams reference](https://nextjs.org/docs/app/api-reference/file-conventions/page#searchparams-optional). The setup page compares `event.id === query.eventId`; an array never equals that string, so `selectedEvent` becomes undefined. The wizard then renders step 1 even though the URL requests step 3. No database failure is required to reproduce this.

The same redundant parameter affects the Review page's two catalogue Edit links and Previous link. The minimal patch removes those four redundant additions, retaining the event ID already present in `base`, `created=1`, locale, step and all authorization checks.

Immediate private-staging workaround: after Continue displays step 1, edit the browser address so `eventId` occurs only once. Retain `wizard=create`, `step=3`, `created=1` and the existing event UUID:

```
https://localhost:18443/en/admin/setup?wizard=create&step=3&eventId=EXISTING_EVENT_UUID&created=1
```

This opens Review for the already saved event. Do not create a replacement event to bypass the navigation problem. Review's catalogue Edit/Previous links have the same duplication until the patch is deployed; remove the second `eventId` there too and keep `step=2`.

Files here:

- `setup-wizard-links.patch`: reviewable patch against the checked-out source.
- `setup-view.tsx`: complete patched candidate for inspection.
- `source.json`: original/candidate hashes and deployment status; no secret material.
- `test-routing.mjs`: dependency-free regression check executing the actual link and event-selection expressions from original/candidate TSX.

Local check:

```bash
node /home/luke/aia-accreditation-staging-kit/review/setup-wizard-links/test-routing.mjs
```

Passed: reproduced the original Catalogues-to-step-1 loop and the broken Review links; candidate reaches Review and returns to Catalogues with exactly one event ID, in English and Portuguese; fresh step-1 behavior remains intact. This is a route-expression regression check, not a live browser/deployment test.

Repository source and running containers are unchanged during preparation. The user has authorized deployment; the dedicated operator command creates an exact reviewed candidate outside the checkout, builds matching images with the existing Dockerfile, selects the candidate through the existing Compose workflow and replaces only the application containers. Do not patch inside running containers, rebuild via the first-deployment-only command, or edit immutable image/build receipts. No live infrastructure change, database change, migration, credential change, commit or push was performed in this session.
