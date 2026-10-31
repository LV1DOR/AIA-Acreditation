import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  effects: [] as (() => void)[], submitted: { current: false },
  form: { requestSubmit: vi.fn() }, configured: true, token: "synthetic-invitation",
  available: true, identity: null as null | { clerkUserId: string },
}));
vi.mock("react", async original => ({ ...await original<object>(),
  useRef: (initial: unknown) => initial === null ? { current: state.form } : state.submitted,
  useEffect: (effect: () => void) => state.effects.push(effect),
}));
vi.mock("../../apps/web/src/app/[locale]/invitation/actions.ts", () => ({ startInvitedSignUp: vi.fn(), acceptInvitation: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.token ? { value: state.token } : undefined }) }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en", getTranslations: async () => (key: string) => key }));
vi.mock("../../packages/domain/src/index.ts", () => ({ invitationAvailable: async () => state.available }));
vi.mock("../../apps/web/src/components/public-header.tsx", () => ({ PublicHeader: () => null }));
vi.mock("../../apps/web/src/server/auth-config.ts", () => ({ authConfigured: () => state.configured }));
vi.mock("../../apps/web/src/server/session.ts", () => ({ invitationIdentity: async () => state.identity }));
vi.mock("../../apps/web/src/server/runtime.ts", () => ({ database: () => ({}) }));

import { AutoStartInvitedSignUp } from "../../apps/web/src/app/[locale]/invitation/auto-start-sign-up.tsx";
import InvitationPage from "../../apps/web/src/app/[locale]/invitation/page.tsx";
import { startInvitedSignUp } from "../../apps/web/src/app/[locale]/invitation/actions.ts";
type Element = { type: unknown; props: Record<string, unknown> };
function find(node: unknown, type: unknown): Element | undefined {
  if (Array.isArray(node)) return node.map(item => find(item, type)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as Element;
  return element.type === type ? element : find(element.props.children, type);
}
beforeEach(() => {
  vi.clearAllMocks(); state.effects = []; state.submitted.current = false;
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
