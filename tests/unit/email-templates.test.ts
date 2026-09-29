import { expect, it } from "vitest";
import { renderBusinessEmail } from "../../packages/email/src/index.ts";

it("renders one bilingual AIA email without sensitive participant data", async () => {
  const email = await renderBusinessEmail("SUBMISSION_RETURNED", { companyName: "Synthetic Company", eventName: "Synthetic Event", appUrl: "https://example.invalid/portal" });
  expect(email.subject).toContain("Correções necessárias / Corrections required");
  expect(email.html).toContain("A submissão foi devolvida");
  expect(email.html).toContain("The submission was returned");
  expect(email.text).toContain("See the required actions in the portal.");
  expect(email.html).not.toContain("documentNumber");
});
