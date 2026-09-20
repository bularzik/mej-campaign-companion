// test/hub-shell-document.test.js
//
// The Hub's placeholder document is a parentless, collection-less stub: any
// write that routes through Document#update reaches Foundry's
// ClientDatabaseBackend, which resolves the document's collection and cannot
// find one. So setFlag/unsetFlag/update must all be local no-ops.
//
// hub-shell-document.mjs extends foundry.abstract.Document at module scope, so
// the globals it touches are stubbed here before the dynamic import.
import { describe, it, expect, beforeAll } from "vitest";

let HubShellDocument;

beforeAll(async () => {
  const merge = (target, source) => Object.assign(target, source);
  globalThis.foundry = {
    abstract: { Document: class StubDocument { constructor() { /* no schema machinery needed */ } } },
    utils: { mergeObject: merge },
    data: {
      fields: {
        StringField: class { constructor(o) { this.o = o; } },
        BooleanField: class { constructor(o) { this.o = o; } },
        ObjectField: class { constructor(o) { this.o = o; } },
        SchemaField: class { constructor(o) { this.o = o; } },
        DocumentFlagsField: class { constructor(o) { this.o = o; } }
      }
    }
  };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
  globalThis.game = { i18n: { localize: (k) => k } };
  ({ HubShellDocument } = await import("../scripts/apps/hub-shell-document.mjs"));
});

describe("HubShellDocument write no-ops", () => {
  it("update() resolves to the document and writes nothing", async () => {
    const doc = new HubShellDocument({ type: "campaign-hub", flags: { a: 1 } });
    // MEJ's EnhancedJournalSheet.onSubmit does exactly this on every form
    // change in the shell-hosted Hub (13.06 sheets/EnhancedJournalSheet.js:1460):
    // `return this.document.update(submitData)`. Reaching Foundry's real
    // update() on this stub raises an unhandled
    // "Cannot read properties of undefined (reading 'get')" out of
    // ClientDatabaseBackend#preUpdateDocumentArray (foundry.mjs:58726) —
    // observed live on Foundry 13.351 / MEJ 13.06 (see the v13 sweep report).
    await expect(doc.update({ flags: { b: 2 }, name: "changed" })).resolves.toBe(doc);
    expect(doc.flags).toEqual({ a: 1 });
    expect(doc.name).toBe(undefined);
  });

  it("setFlag() and unsetFlag() stay no-ops that resolve to the document", async () => {
    const doc = new HubShellDocument({ type: "campaign-hub", flags: { a: 1 } });
    await expect(doc.setFlag("scope", "key", 1)).resolves.toBe(doc);
    await expect(doc.unsetFlag("scope", "key")).resolves.toBe(doc);
    expect(doc.flags).toEqual({ a: 1 });
  });
});
