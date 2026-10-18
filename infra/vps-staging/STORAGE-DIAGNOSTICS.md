Latest result: all positive live operations passed; only the two CreateBucket-denial assertions failed with HTTP 400. Their generated bucket names were invalid (67 characters). See [BUCKET-NAME-FIX.md](BUCKET-NAME-FIX.md) for the targeted correction and retry command. The earlier evidence table below describes the preceding bulk-diagnostic failure, not the latest live result.

Storage diagnostic update, 17 October 2026.

Run only:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py storage-check
```

No `infra`, `build`, AIStor preparation, restart, database bootstrap or migration command is needed. This reuses the running staging dependencies and unchanged application images, starting only a new maintenance job with `--no-deps`. Old failed jobs and every persistent volume remain intact. The existing generated S3 users and the same bucket-only policy are provisioned as before; no administrator policy is assigned to a scoped user. Only new `_staging/probe/` synthetic objects and the existing provisioning marker are used. Ordinary and version-specific deletion tests delete only their own fresh synthetic fixtures.

The previous evidence is conclusive only at this level:

| Area | Existing evidence |
| --- | --- |
| Administrator client/authentication over verified TLS | Passed `AISTOR_CLIENT_AND_LICENSE_INFO` |
| Dedicated private bucket and disabled versioning | Passed `NEW_PRIVATE_UNVERSIONED_BUCKET` |
| Web/worker local credential configuration | Both expected identities, endpoint and bucket match; secrets match their provisioning values and differ from the administrator's; values were not printed |
| Policy creation, user creation, policy attachment and scoped readiness | Exact live failure unknown: all shared the old `SCOPED_CREDENTIALS_AND_POLICY` label |
| Scoped upload/download/ordinary delete and conditional PUT | Not established by the failed run |
| Actual version-specific deletion and application erasure | Not reached/proven by the failed run |

The old test threw `CHECK_FAILED` for every nonzero `mc` exit and discarded the response. It also swallowed error codes in its CreateBucket-denial assertion, and grouped HeadBucket/GetBucketPolicy/GetBucketVersioning under one stage. The precise old failing assertion cannot be reconstructed from that saved evidence. There is no basis to claim that the old failure was a Free-license refusal, a bad password or an application API incompatibility.

The updated test reports independent operation results for administrator, web and worker identities. The administrator role is a diagnostic baseline only; scoped operations always use their own credentials. Stages/operations include:

- `TLS / MC_ALIAS_SET` and `LICENSE / MC_LICENSE_INFO`.
- `BUCKET / LIST_BUCKETS_AND_CHECK_SCOPE`, synthetic marker verification, `VERIFY_UNVERSIONED` and `VERIFY_PRIVATE_POLICY`.
- `IAM / MC_POLICY_CREATE`, `MC_USER_ADD`, `MC_POLICY_ATTACH`, and `CREATE_BUCKET_DENIED`.
- Scoped/admin `HEAD_BUCKET`, `GET_BUCKET_POLICY` and `GET_BUCKET_VERSIONING` separately.
- `PUT_OBJECT`, `GET_OBJECT`, `HEAD_OBJECT`, `LIST_OBJECTS`, anonymous rejection, conditional PUT rejection and original-content verification.
- `DELETE_OBJECT` and independent absence verification after ordinary deletion.
- `LIST_OBJECT_VERSIONS`, followed by `DELETE_OBJECT_WITH_RETURNED_VERSION_ID` using an actual nonempty returned ID, including the literal `"null"` ID. A missing returned ID blocks this proof; disabled bucket versioning alone never passes it.
- `APPLICATION_ERASE_PHOTO_AND_VERIFY`, using a fresh synthetic fixture and the **unchanged** application's implementation.

Independent operations continue after a failure so administrator/scoped and ordinary/version-specific behavior can be compared in one run. Dependent operations print `BLOCKED` if their fixture could not be created. Any failure or blocked required operation still makes the overall test fail. Scope/private/unversioned-marker failures prevent further object writes.

The PuTTY output and protected job log now include a sanitized JSON line per operation. Example format only; this is **not** a claim about the live result:

```json
{"stage":"OBJECTS","operation":"GET_BUCKET_VERSIONING","role":"web","status":"FAIL","code":"AccessDenied","httpStatus":403,"classification":1}
```

Assertions have static identifiers such as `CREDENTIAL_CONFIG_MISMATCH` or `EXPECTED_PRECONDITION_FAILED`. CLI failures include `exitCode` and a recognized S3 code extracted from `mc --json` error output. Unknown codes remain `UnknownError`/`CLIExitFailure` rather than dumping server text. No raw CLI response, error message, request, URL query, bucket/object ID, contents, key, password, license metadata or license text is printed. `mc license info` output is discarded. The evidence is saved at `state/backups/storage-check.json`; it is diagnostic evidence, not a backup archive.

Classification meanings:

1. **Staging configuration/credentials/IAM:** specific authentication, authorization, policy, certificate or network error, or an explicit configuration assertion. Administrator success plus scoped AccessDenied identifies a scoped authorization issue; broadening to administrator is not a fix.
2. **Test implementation:** explicit internal TypeError/ReferenceError/SyntaxError or an internal test assertion. Loss of operation/error detail in the prior test is a confirmed implementation defect corrected here.
3. **License:** only explicit `XMinioPaidTierLicenseRequired` or `XMinioFeatureNotLicensed`. A generic 405 is not sufficient. Ordinary DELETE success and exact-version DELETE failure are separate results.
4. **Application/storage API incompatibility:** explicit unsupported-method/operation errors or a failed protocol assertion such as a conditional overwrite being accepted. The actual app erasure routine remains required.

Unknown errors stay unclassified; one failed IAM operation does not explain every other result. Root and scoped results are not interchangeable. Official [AIStor licensing documentation](https://docs.min.io/aistor/operations/licenses/) excludes version-specific object deletion from Free, while the [S3 compatibility reference](https://docs.min.io/aistor/developers/s3-api-compatibility/) documents the general API/conditional-header surface. The test verifies the exact requests on this deployment rather than treating those general documents or an unversioned bucket as successful runtime proof.

Expected command outcome: `VALIDATION_PASSED`, operation results, and finally either `STORAGE_CHECK_PASSED` or an exact `STORAGE_CHECK_FAILED_<operation>` line. Only the former permits proceeding to the existing bootstrap/migration sequence. On failure, use the emitted FAIL lines (role, operation, code, status and classification) for the next targeted correction. Do not paste raw configuration, credentials, license or unrelated Docker logs.

Local verification: 16 Python regression tests, six JavaScript diagnostic/redaction tests, and five in-memory full-runtime scenarios passed. The full-runtime harness executes the staging test together with the unchanged application storage adapter against synthetic S3/CLI fixtures: full success; policy-creation failure while independent probes continue; scoped GetBucketVersioning denial; ordinary deletion success versus paid-tier exact-version/app-erasure refusal; and missing version IDs. These are simulated results, not live compatibility claims. No Docker daemon, live S3 request, service change, database provisioning or migration was executed in this session.
