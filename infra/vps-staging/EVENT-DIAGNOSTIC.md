Event wizard save diagnosis.

The current app catches every non-redirect error in `createWizardEventAction` and returns only `result=error`. It does not log the underlying exception. The banner alone cannot identify the cause, and raw Docker logs will not recover that swallowed exception. Do not rebuild or change validation based only on this banner.

Fill the synthetic event form again. Before clicking Next, open the browser developer Console (F12) and evaluate this expression. It reads only the five event fields; no cookies, session tokens, invitation tokens or credentials are accessed:

```javascript
JSON.stringify(Object.fromEntries(['name','startDate','endDate','onboardingOpensAt','onboardingClosesAt'].map(n=>[n,document.querySelector(`input[name="${n}"]`)?.value??''])))
```

Copy the resulting JSON **object text**, without the Console's enclosing display quotes. In PuTTY run:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/diagnose-event.py --form-json
```

Paste the object at the prompt. The command reuses the existing immutable tools image and starts only one isolated maintenance job with `--no-deps`; it retains the job, starts no dependent service, rebuilds nothing, and performs no migration. It uses the actual app's input validation with a fake database client that immediately aborts before a transaction callback executes. It separately connects using the existing **web** role and sets the real transaction **READ ONLY before all queries**. Target guards require the dedicated staging database, synthetic marker and restricted web login. No event is created, updated or deleted, and no credentials or application files are changed.

Expected: `EVENT_DIAGNOSTIC_COMPLETE` and sanitized JSON. A protected report is saved under the existing state/logs directory; input values and credentials are not included.

- `validationPassed: false` with `issues`: actual app validation rejected a field. Empty hidden values, invalid calendar/ISO dates, an identifier longer than 100 characters, event start after event end, or opening at/after closing are possible. Date-time fields must include an offset or Z; the actual picker serializes them with Z.
- `matchingIdentifierExists: true`: the name generates an identifier already used by an event. This is also consistent with an earlier successful save followed by a redirect/cache error; inspect the existing event rather than assuming its save failed.
- Any false `event_insert`, `audit_insert` or `outbox_insert`: a required database grant is missing. The tool does not change it.
- `restoreQuarantineActive: true` or `activeAdminExists: false`: a distinct access prerequisite needs investigation; this check does not claim to identify the browser's particular user.
- `databaseError`: allowlisted Prisma/network code only. No raw error, SQL parameters or database URL is logged.

If every check passes, these checks have narrowed the issue but have not reproduced the browser action's complete transaction or session. Preserve the result and the browser redirect URL (omit tokens). A further targeted probe is needed; do not declare the save fixed or broaden permissions.

Local tests: four in-memory TypeScript scenarios verify the fake validation client, read-only-before-query ordering, duplicate detection and redaction; one Python command test verifies project scoping, stdin handling, existing image selection and no `up`, `down` or `--rm`. Python/TypeScript syntax checks passed. No live Docker or database operation was executed during preparation. These standalone diagnostic files are outside the hashed deployment runtime directory and do not change the installed kit revision or require a new build/review receipt.
