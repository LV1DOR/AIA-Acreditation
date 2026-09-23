import { expect, it } from "vitest";
import { messages } from "../../packages/i18n/src/index.ts";
function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, item]) => typeof item === "object" ? keys(item, prefix + key + ".") : [prefix + key]).sort();
}
it("keeps Portuguese and English message keys aligned", () => { expect(keys(messages.pt)).toEqual(keys(messages.en)); });

