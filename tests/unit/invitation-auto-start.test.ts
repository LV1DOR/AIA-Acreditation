import { beforeEach, expect, it, vi } from "vitest";

import { invitationUIHarness, type UIElement as Element, type InvitationUIState } from "../fixtures/invitation-ui-harness.ts";
const state: InvitationUIState = { effects: [], submitted: { current: false }, form: { requestSubmit: vi.fn() }, configured: true, token: "synthetic-invitation", available: true, identity: null };
const startInvitedSignUp = vi.fn(), acceptInvitation = vi.fn();
let AutoStartInvitedSignUp: ReturnType<typeof invitationUIHarness>["AutoStartInvitedSignUp"];
let InvitationPage: ReturnType<typeof invitationUIHarness>["InvitationPage"];
function find(node: unknown, type: unknown): Element | undefined {
  if (Array.isArray(node)) return node.map(item => find(item, type)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as Element;
  return element.type === type ? element : find(element.props.children, type);
}
beforeEach(() => {
  vi.clearAllMocks(); state.effects = []; state.submitted.current = false;
  ({ AutoStartInvitedSignUp, InvitationPage } = invitationUIHarness(state, { startInvitedSignUp, acceptInvitation }));
  state.configured = true; state.token = "synthetic-invitation"; state.available = true; state.identity = null;
});
it("submits the existing server action once, even when the effect runs twice", () => {
  const tree = AutoStartInvitedSignUp({ locale: "en", autoStart: true, retryLabel: "Retry" }) as Element;
  expect(tree.props.action).toBe(startInvitedSignUp);
  state.effects[0]!(); state.effects[0]!();
  expect(state.form.requestSubmit).toHaveBeenCalledTimes(1);
  expect(startInvitedSignUp).not.toHaveBeenCalled();
});
it.each(["pt", "en"] as const)("keeps %s retry manual and preserves the locale", locale => {
  const tree = AutoStartInvitedSignUp({ locale, autoStart: false, retryLabel: "Retry" }) as Element;
  state.effects[0]!();
  expect(state.form.requestSubmit).not.toHaveBeenCalled();
  expect(find(tree, "button")?.props.children).toBe("Retry");
  expect(find(tree, "input")?.props.value).toBe(locale);
});
it("starts only an available unsigned-in invitation and does not auto-loop after failure", async () => {
  let tree = await InvitationPage({ searchParams: Promise.resolve({}) });
  expect(find(tree, AutoStartInvitedSignUp)?.props.autoStart).toBe(true);
  tree = await InvitationPage({ searchParams: Promise.resolve({ error: "unavailable" }) });
  expect(find(tree, AutoStartInvitedSignUp)?.props.autoStart).toBe(false);
});
it.each(["unconfigured", "missing", "unavailable", "signed-in"])("does not auto-create a ticket for %s state", async kind => {
  if (kind === "unconfigured") state.configured = false;
  if (kind === "missing") state.token = "";
  if (kind === "unavailable") state.available = false;
  if (kind === "signed-in") state.identity = { clerkUserId: "synthetic-existing-leader" };
  const tree = await InvitationPage({ searchParams: Promise.resolve({}) });
  expect(find(tree, AutoStartInvitedSignUp)).toBeUndefined();
});
