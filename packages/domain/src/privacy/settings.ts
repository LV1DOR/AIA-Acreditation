/** New notices are shared; historical notice/acknowledgement rows stay immutable. */
export const sharedPrivacyNoticeKind = "WORKER" as const;

/** An internal audit identifier, not a claim of external/legal approval. */
export function privacyActionReference(correlationId:string) {
  return `admin-action:${correlationId}`;
}

/** No separate notification/evidence schedule in a new simplified policy. */
export function privacyRetentionDates(recordsEraseAfter:Date,backupsEraseAfter:Date) {
  return {recordsEraseAfter,evidenceEraseAfter:recordsEraseAfter,
    communicationsEraseAfter:recordsEraseAfter,backupsEraseAfter};
}
