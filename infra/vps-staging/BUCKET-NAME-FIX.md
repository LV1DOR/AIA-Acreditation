Storage permission probe correction, 17 October 2026.

The confirmed test defect is the CreateBucket probe name:

```
old: aia-accreditation-staging-deny- + randomUUID() = 31 + 36 = 67 characters
new: aia-stg-deny-                  + randomUUID() = 13 + 36 = 49 characters
```

S3 bucket names have a [63-character maximum](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html). The old request was invalid and its HTTP 400 cannot establish authorization enforcement. This is a **category 2: test implementation defect**. The old diagnostics omitted `InvalidBucketName` and discarded unrecognized response details, so the exact original server XML code and internal AIStor validation order cannot be reconstructed. Name validation is the identified input defect consistent with the 400; the valid live request must still prove denial.

All three configured clients use `us-east-1`. The existing request's omission of `CreateBucketConfiguration` is correct there, as documented by the [CreateBucket API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CreateBucket.html). The helper now validates the name/region before sending, preserves the entire random UUID, and supplies a location constraint for other regions. The endpoint, path-style addressing, TLS verification, credentials and bucket-scoped policy are unchanged. Web/worker retain no `s3:CreateBucket` permission. No administrator CreateBucket positive control or bucket cleanup has been added or executed.

Recognized input-validation codes are now reported. The sanitizer checks SDK `code`/`Code`, causes, and already-buffered XML `<Code>` (bounded to 64 KiB); a specific recognized code takes precedence over generic `UnknownError`. It never prints the response body, error message, request, keys, object data or license details, and never consumes a response stream. Unavailable/unrecognized details remain `UnknownError`. **Only `AccessDenied` with HTTP 403 passes the negative permission test.** HTTP 400, wrong credentials, unexpected success and unsupported-operation responses still fail.

The exact-version test already rejects missing/empty returned IDs before issuing DELETE and passes each actual returned ID as `VersionId`. It never substitutes ordinary deletion. Successful evidence now includes `returnedVersionIdUsed: true` and `versionIdKind: "null-version"` or `"version-id"`, without disclosing the identifier. The configured bucket is intentionally unversioned: an explicit returned `"null"` version is a real version-specific request, but does not prove deletion of historical versions in a versioned bucket or general Free-license support for that feature. The unchanged application erasure routine remains a separate mandatory test.

Run this **single next command in PuTTY**:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py storage-check
```

Expected: `VALIDATION_PASSED`, all required operation records, including:

```json
{"stage":"IAM","operation":"CREATE_BUCKET_DENIED","role":"web","status":"PASS"}
{"stage":"IAM","operation":"CREATE_BUCKET_DENIED","role":"worker","status":"PASS"}
```

The final line must be `STORAGE_CHECK_PASSED`. The PASS assertion requires the exact 403/AccessDenied response internally. A failed operation or nonzero command means stop before bootstrap/migrations and retain the sanitized FAIL lines. Do not rerun infrastructure startup, AIStor preparation or image builds. If the valid request still returns 400, it remains a failure; use the new sanitized code to investigate further rather than accepting it as denial.

The retry starts only a new, uniquely named maintenance job with `--no-deps`; failed jobs remain retained. Existing credentials, certificates, image references, infrastructure containers and volumes are preserved. It reuses the current storage test's synthetic fixtures and existing bucket-scoped IAM provisioning. No database work occurs. The kit revision guard records the exact reviewed transition in a new private `bucket-name-fix.json` receipt and preserves the earlier build/adapter/revision receipts. Later unreviewed changes still fail closed.

Local validation passed: 17 Python regression tests (including receipt preservation/no Docker calls for the revision guard); eight JavaScript diagnostic tests; seven in-memory full-runtime scenarios executing the unchanged app adapter; Python compilation. The runtime fixture now uses full-length UUIDs and rejects invalid bucket names before returning AccessDenied, reproducing the original test's overlooked input constraint. Additional scenarios reject HTTP 400 and missing version IDs, and verify propagation of both null and historical-shaped returned identifiers. These are local simulations, not claims about live historical-version support. No Docker daemon, live S3 operation, privileged operation, service change, image build, database provisioning or migration was executed.
