import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

export type UIElement = { type: unknown; props: Record<string, unknown> };
export type InvitationUIState = {
  effects: (() => void)[]; submitted: { current: boolean }; form: { requestSubmit: () => void };
  configured: boolean; token: string; available: boolean; identity: null | { clerkUserId: string };
};

// Evaluate the actual TSX with explicit boundary stubs. Bare-package vi.mock calls
// can resolve a different pnpm/conditional-export entry from the web workspace.
// This loader fails on any unstubbed import; no Next/Clerk/DB implementation loads.
export function invitationUIHarness(state: InvitationUIState, actions: { startInvitedSignUp: () => void; acceptInvitation: () => void }) {
  const require = createRequire(import.meta.url);
  const ts = require(process.env.AIA_TYPESCRIPT_PATH ?? "typescript") as typeof import("typescript");
  const jsx = (type: unknown, props: Record<string, unknown>): UIElement => ({ type, props });
  function load(file: string, dependencies: Record<string, unknown>) {
    const source = readFileSync(new URL("../../apps/web/src/app/[locale]/invitation/" + file, import.meta.url), "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} as Record<string, unknown> };
    new Function("require", "module", "exports", output)((name: string) => {
      if (!Object.prototype.hasOwnProperty.call(dependencies, name)) throw new Error("UNSTUBBED_INVITATION_UI_IMPORT");
      return dependencies[name];
    }, module, module.exports);
    return module.exports;
  }
  const runtime = { jsx, jsxs: jsx, Fragment: Symbol("synthetic-fragment") };
  const client = load("auto-start-sign-up.tsx", {
    "react/jsx-runtime": runtime,
    react: { useRef: (initial: unknown) => initial === null ? { current: state.form } : state.submitted, useEffect: (effect: () => void) => state.effects.push(effect) },
    "./actions.ts": actions,
  });
  const page = load("page.tsx", {
    "react/jsx-runtime": runtime,
    "next/headers": { cookies: async () => ({ get: () => state.token ? { value: state.token } : undefined }) },
    "next-intl/server": { getLocale: async () => "en", getTranslations: async () => (key: string) => key },
    "@aia/domain": { invitationAvailable: async () => state.available },
    "../../../components/public-header.tsx": { PublicHeader: () => null },
    "../../../components/notice.tsx": { Notice: () => null },
    "../../../server/auth-config.ts": { authConfigured: () => state.configured },
    "../../../server/session.ts": { invitationIdentity: async () => state.identity },
    "../../../server/runtime.ts": { database: () => ({}) },
    "./actions.ts": actions,
    "./auto-start-sign-up.tsx": client,
  });
  return {
    AutoStartInvitedSignUp: client.AutoStartInvitedSignUp as (props: { locale: "pt" | "en"; autoStart: boolean; retryLabel: string }) => UIElement,
    InvitationPage: page.default as (props: { searchParams: Promise<{ error?: string }> }) => Promise<UIElement>,
  };
}
