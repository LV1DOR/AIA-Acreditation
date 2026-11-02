import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

type Props = Record<string, unknown>;
export type ModalElement = { type: unknown; props: Props };
type Frame = { hooks: unknown[]; cleanups: Map<number, () => void> };
type LinkResult = { link?: string; error?: string };

// Evaluate the actual TSX against explicit boundaries, without loading Next,
// Clerk, database or SMTP. Model component instances, hook slots and unmounts.
export function addParticipantUIHarness(locale: "pt" | "en", employeeLinks = true, disabled = false, sourceOverride?: string) {
  const require = createRequire(import.meta.url);
  const ts = require(process.env.AIA_TYPESCRIPT_PATH ?? "typescript") as typeof import("typescript");
  const source = sourceOverride ?? readFileSync(new URL("../../apps/web/src/components/add-participant-modal.tsx", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const frames = new Map<string, Frame>();
  const listeners = new Set<(event: { key: string }) => void>();
  const effects: (() => void)[] = [];
  const pendingRequests: { frame: Frame; slot: number }[] = [];
  const copied: string[] = [];
  let current: Frame;
  let cursor = 0;
  let requests = 0;
  const jsx = (type: unknown, props: Props): ModalElement => ({ type, props });
  const manualAction = () => { throw new Error("MANUAL_SERVER_ACTION_MUST_NOT_EXECUTE_IN_UI_TEST"); };
  const linkAction = Symbol("stubbed-link-server-action");
  const stateHook = (initial: unknown) => {
    const frame = current, slot = cursor++;
    if (!(slot in frame.hooks)) frame.hooks[slot] = initial;
    return [frame.hooks[slot], (value: unknown) => { frame.hooks[slot] = value; }];
  };
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("fragment") },
    react: {
      useState: stateHook,
      useCallback: (fn: unknown) => { const slot = cursor++; if (!(slot in current.hooks)) current.hooks[slot] = fn; return current.hooks[slot]; },
      useActionState: (action: unknown, initial: LinkResult) => {
        if (action !== linkAction) throw new Error("UNEXPECTED_SERVER_ACTION");
        const frame = current, slot = cursor++;
        if (!(slot in frame.hooks)) frame.hooks[slot] = { result: initial, pending: false };
        const value = frame.hooks[slot] as { result: LinkResult; pending: boolean };
        return [value.result, () => { requests++; value.pending = true; pendingRequests.push({ frame, slot }); }, value.pending];
      },
      useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
        const frame = current, slot = cursor++;
        const old = frame.hooks[slot] as unknown[] | undefined;
        if (old && old.length === deps.length && old.every((value, i) => Object.is(value, deps[i]))) return;
        frame.hooks[slot] = deps;
        effects.push(() => { frame.cleanups.get(slot)?.(); const cleanup = effect(); if (cleanup) frame.cleanups.set(slot, cleanup); });
      },
    },
    "../app/[locale]/company/[registrationId]/actions.ts": { createParticipantAction: manualAction, createParticipantLinkAction: linkAction },
    "./portal-icon.tsx": { PortalIcon: () => null },
  };
  const module = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", "document", "navigator", output)((name: string) => {
    if (!Object.prototype.hasOwnProperty.call(dependencies, name)) throw new Error("UNSTUBBED_MODAL_IMPORT");
    return dependencies[name];
  }, module, module.exports, {
    addEventListener: (_name: string, listener: (event: { key: string }) => void) => listeners.add(listener),
    removeEventListener: (_name: string, listener: (event: { key: string }) => void) => listeners.delete(listener),
  }, { clipboard: { writeText: async (value: string) => { copied.push(value); } } });
  const Component = module.exports.AddParticipantModal as (props: Props) => unknown;
  let tree: ModalElement[] = [];
  function render() {
    const visited = new Set<string>(); tree = [];
    function visit(value: unknown, path: string) {
      if (Array.isArray(value)) { value.forEach((child, i) => visit(child, path + "/" + i)); return; }
      if (!value || typeof value !== "object" || !("type" in value) || !("props" in value)) return;
      const element = value as ModalElement;
      if (typeof element.type === "function") {
        visited.add(path);
        if (!frames.has(path)) frames.set(path, { hooks: [], cleanups: new Map() });
        current = frames.get(path)!; cursor = 0;
        visit(element.type(element.props), path + "/render");
      } else { tree.push(element); visit(element.props.children, path + "/children"); }
    }
    visit(jsx(Component, { locale, registrationId: "synthetic-registration", employeeLinks, disabled }), "root");
    for (const [path, frame] of frames) if (!visited.has(path)) { for (const cleanup of frame.cleanups.values()) cleanup(); frames.delete(path); }
    while (effects.length) effects.shift()!();
    return tree;
  }
  function find(predicate: (element: ModalElement) => boolean) {
    const value = tree.find(predicate); if (!value) throw new Error("EXPECTED_MODAL_ELEMENT_MISSING"); return value;
  }
  function click(element: ModalElement, event?: unknown) {
    if (element.props.disabled) throw new Error("DISABLED_CONTROL_MUST_NOT_EXECUTE");
    return (element.props.onClick as ((event?: unknown) => unknown) | undefined)?.(event);
  }
  return {
    render, find, click, copied, manualAction,
    requests: () => requests,
    listenerCount: () => listeners.size,
    escape: () => { for (const listener of [...listeners]) listener({ key: "Escape" }); },
    submitLink: () => {
      const form = find(element => element.type === "form" && element.props.action !== manualAction);
      click(find(element => element.type === "button" && element.props.type === "submit" && element.props.className?.toString().includes("selected") === true));
      (form.props.action as () => void)();
    },
    completeLink: (result: LinkResult) => {
      const target = pendingRequests.shift(); if (!target) throw new Error("EXPECTED_PENDING_SYNTHETIC_REQUEST");
      target.frame.hooks[target.slot] = { result, pending: false };
    },
  };
}
