import { parsePhoneNumberFromString } from "libphonenumber-js";
import { DomainError } from "../shared/errors.ts";

export function normalizePhoneNumber(value: string) {
  const parsed = parsePhoneNumberFromString(value);
  if (!parsed?.isPossible()) throw new DomainError("INVALID_INPUT");
  return parsed.number;
}
