# Phase 6 requests

Company leaders use the registration Requests hub to submit typed, reasoned changes for AIA review. PostgreSQL is the source of truth; every request is membership-scoped, versioned, audited and surfaced in the administrator Action Required queue. Urgent requests are visually prioritised but never bypass AIA approval.

Supported request effects are extra personnel capacity, additions and removals after the deadline, emergency replacement, work-day changes, vehicle-pass changes, event-zone selection changes and non-automatic general requests. Zone changes store selected event-zone IDs from a checkbox list; they never use a quantity field.

An emergency replacement is a two-stage flow. AIA first approves the urgent request. In the same serializable transaction the original participant becomes `REPLACED`, unused employee links are revoked, and one linked draft replacement is created. This does not change `personnelLimit` and does not consume an additional active place. The leader must complete and approve the new participant. A new immutable final submission then returns the registration to normal AIA review. The approved request is linked to that submission so it cannot keep a post-deadline edit window open.

Approved changes that affect submitted registration content reopen the registration as `RETURNED_FOR_CORRECTION`. The leader overview shows the latest return/rejection reason and comment without exposing snapshot hashes or internal integrity terminology.

In-app request notifications are durable. Workflow email delivery and realtime refresh remain Phase 7 work.
