import assert from "node:assert/strict";
import { it } from "vitest";
import { addParticipantUIHarness } from "../fixtures/add-participant-ui-harness.ts";

for (const locale of ["pt", "en"] as const) {
  const openLabel = locale === "pt" ? "Adicionar pessoa" : "Add person";
  const closeLabel = locale === "pt" ? "Fechar janela" : "Close dialog";
  function setup(employeeLinks = true, disabled = false) {
    const ui = addParticipantUIHarness(locale, employeeLinks, disabled);
    ui.render();
    return ui;
  }
  function open(ui: ReturnType<typeof setup>) {
    ui.click(ui.find(element => element.type === "button" && element.props.children !== undefined && element.props.className === "button primary")); ui.render();
  }
  function generate(ui: ReturnType<typeof setup>) {
    ui.click(ui.find(element => element.type === "button" && element.props.className === "worker-choice ")); ui.render();
    ui.submitLink(); ui.render();
  }
  function assertFresh(ui: ReturnType<typeof setup>) {
    const tree = ui.render();
    assert.equal(tree.filter(element => element.type === "form").length, 2);
    assert.equal(tree.some(element => element.type === "input" && element.props.readOnly === true), false);
    assert.equal(tree.some(element => element.props.className === "flash error"), false);
    assert.equal(tree.some(element => element.props.className === "copy-feedback visible"), false);
    assert.equal(ui.listenerCount(), 1);
  }
  for (const close of ["button", "escape", "backdrop", "footer"] as const) {
    it(`${locale}: starts fresh after generating/copying a link and closing via ${close}`, async () => {
      const ui = setup(); open(ui); generate(ui);
      assert.equal(ui.requests(), 1);
      ui.completeLink({ link: "https://example.invalid/synthetic-one-time-link" }); ui.render();
      await ui.click(ui.find(element => element.type === "button" && element.props.title !== undefined)); ui.render();
      assert.deepEqual(ui.copied, ["https://example.invalid/synthetic-one-time-link"]);
      if (close === "button") ui.click(ui.find(element => element.props["aria-label"] === closeLabel));
      if (close === "escape") ui.escape();
      if (close === "footer") ui.click(ui.find(element => element.type === "button" && element.props.className === "button secondary"));
      if (close === "backdrop") {
        const backdrop = ui.find(element => element.props.className === "portal-modal-backdrop");
        const target = {}; (backdrop.props.onMouseDown as (event: unknown) => void)({ currentTarget: target, target });
      }
      ui.render(); assert.equal(ui.listenerCount(), 0);
      open(ui); assertFresh(ui); assert.equal(ui.requests(), 1);
      generate(ui); assert.equal(ui.requests(), 2);
    });
  }
  it(`${locale}: discards an error after closing and does not submit automatically`, () => {
    const ui = setup(); open(ui); generate(ui); ui.completeLink({ error: "SYNTHETIC_FAILURE" }); ui.render();
    assert.ok(ui.find(element => element.props.className === "flash error"));
    ui.escape(); ui.render(); open(ui); assertFresh(ui); assert.equal(ui.requests(), 1);
  });
  it(`${locale}: a response arriving after dismissal cannot populate a reopened dialog`, () => {
    const ui = setup(); open(ui); generate(ui); ui.escape(); ui.render(); open(ui);
    ui.completeLink({ link: "https://example.invalid/old-response" }); assertFresh(ui);
  });
  it(`${locale}: preserves manual action, deadline restriction and registration fields`, () => {
    const ui = setup(false); open(ui);
    assert.equal(ui.find(element => element.type === "form" && element.props.action === ui.manualAction).props.action, ui.manualAction);
    assert.equal(ui.find(element => element.type === "button" && element.props.className === "worker-choice ").props.disabled, true);
    const tree = ui.render();
    assert.equal(tree.filter(element => element.type === "input" && element.props.name === "registrationId" && element.props.value === "synthetic-registration").length, 2);
    assert.equal(tree.filter(element => element.type === "input" && element.props.name === "locale" && element.props.value === locale).length, 2);
    assert.equal(ui.requests(), 0);
  });
  it(`${locale}: disables opening when the registration does not permit edits`, () => {
    const ui = setup(true, true); const tree = ui.render();
    assert.equal(tree.some(element => element.props.role === "dialog"), false);
    assert.equal(ui.find(element => element.props.className === "button primary").props.disabled, true);
    assert.equal(ui.listenerCount(), 0); assert.equal(ui.requests(), 0);
    assert.ok((ui.find(element => element.props.className === "button primary").props.children as unknown[]).includes(openLabel));
  });
}
