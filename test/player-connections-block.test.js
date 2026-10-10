// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildConnectionsBlock, groupSideViews, DEBOUNCE_MS } from "../scripts/apps/player-connections-block.mjs";

const labels = {
  heading: "Player connections", relationship: "Relationship", add: "Add connection", addNote: "Add a note",
  empty: "No player connections yet.", by: (n) => `by ${n}`, you: "Me", shared: "Shared", private: "Private",
  reveal: "Reveal", hide: "Hide", revealTooltip: "Reveal tip", deleteConnection: "Delete connection",
  deleteNote: "Delete note", unresolved: "Unknown entry", labelPlaceholder: "Connection",
  secretPlaceholder: "Secret", fallbackImg: "fallback.svg", unknownWriter: "Unknown player"
};
const note = (over = {}) => ({ writerId: "u2", authorName: "Jo", label: "half-sister", revealed: false, secretVisible: false,
  secret: "", editable: false, canReveal: false, canDelete: false, ...over });
const view = (over = {}) => ({
  id: "c1", side: "from", from: "JournalEntry.ilva", to: "JournalEntry.mara", otherUuid: "JournalEntry.mara", reverse: false,
  shared: true, authorId: "u1", authorName: "Dana", foreignAuthor: false, isAuthor: false, showAuthor: true, viewerId: "u3",
  main: note({ writerId: "u1", authorName: "Dana", label: "Sister of" }), others: [],
  canAddNote: false, canToggleShare: false, canDelete: false, ...over
});
const mara = { uuid: "JournalEntry.mara", name: "Mara", img: "mara.png", type: "person" };
const build = (entries, opts = {}, handlers = {}) => buildConnectionsBlock(document,
  { groups: groupSideViews(entries, { typeLabel: (t) => t.toUpperCase() }), canAdd: false, labels, ...opts }, handlers);

afterEach(() => vi.useRealTimers());

describe("buildConnectionsBlock - markup (spec §4.5)", () => {
  it("reuses MEJ's relationship list markup, without MEJ's .relationships drop-zone wrapper", () => {
    const root = build([{ view: view(), target: mara }]);
    expect(root.matches("section.mej-cc-player-connections")).toBe(true);
    expect(root.classList.contains("relationships")).toBe(false);
    expect(root.querySelector("h3").textContent).toBe("Player connections");
    expect(root.querySelector(".items-list ol.item-list li header .name").textContent).toBe("PERSON");
    const row = root.querySelector('li.item.flexrow.mej-cc-pc-row[data-connection-id="c1"]');
    expect(row.dataset.side).toBe("from");
    expect(row.dataset.uuid).toBe("JournalEntry.mara");
    expect(row.querySelector(".item-name img.item-image.large").getAttribute("src")).toBe("mara.png");
    expect(row.querySelector(".mej-cc-pc-open").textContent).toBe("Mara");
    expect(row.querySelector(".item-relationship .mej-cc-pc-label").textContent).toBe("Sister of");
    expect(row.querySelector(".mej-cc-pc-author").textContent).toBe("by Dana");
  });
  it("reverse rows read ← name; own rows carry no author line", () => {
    const root = build([{ view: view({ reverse: true, side: "to", otherUuid: "JournalEntry.ilva", showAuthor: false }),
      target: { ...mara, uuid: "JournalEntry.ilva", name: "Ilva" } }]);
    expect(root.querySelector(".mej-cc-pc-open").textContent).toBe("← Ilva");
    expect(root.querySelector(".mej-cc-pc-author")).toBeNull();
  });
  it("client-writable text is never parsed as markup (Review Focus 4)", () => {
    const evil = '<img src=x onerror="window.__pwn=1"><b>bold</b>';
    const root = build([{ view: view({ authorName: evil, main: note({ writerId: "u1", label: evil, secret: evil, secretVisible: true }),
      others: [note({ authorName: evil, label: evil })] }), target: { ...mara, name: evil } }]);
    expect(root.querySelectorAll("img").length).toBe(1);
    expect(root.querySelectorAll("b").length).toBe(0);
    expect(root.textContent).toContain(evil);
    expect(window.__pwn).toBeUndefined();
  });
  it("a secret shows only when visible", () => {
    const hidden = build([{ view: view({ main: note({ writerId: "u1", label: "x", secret: "", secretVisible: false }) }), target: mara }]);
    expect(hidden.querySelector(".mej-cc-pc-secret")).toBeNull();
    const shown = build([{ view: view({ main: note({ writerId: "u1", label: "x", secret: "owes", secretVisible: true }) }), target: mara }]);
    expect(shown.querySelector(".mej-cc-pc-secret").textContent).toBe("owes");
  });
  it("other players' notes list beneath the row, attributed", () => {
    const root = build([{ view: view({ others: [note()] }), target: mara }]);
    const li = root.querySelector('li.mej-cc-pc-notes-row[data-connection-id="c1"] li.mej-cc-pc-note[data-writer-id="u2"]');
    expect(li.querySelector(".mej-cc-pc-writer").textContent).toBe("Jo");
    expect(li.querySelector(".mej-cc-pc-label").textContent).toBe("half-sister");
    expect(li.querySelector("input")).toBeNull();
  });
  it("an unresolved target renders as MEJ's defunct row, grouped last, not openable", () => {
    const open = vi.fn();
    const root = build([{ view: view({ id: "c2" }), target: null }, { view: view(), target: mara }], {}, { open });
    const headers = [...root.querySelectorAll("header .name")].map((h) => h.textContent);
    expect(headers).toEqual(["PERSON", "DEFUNCT"]);
    const row = root.querySelector('li[data-connection-id="c2"]');
    expect(row.classList.contains("defunct")).toBe(true);
    row.querySelector(".mej-cc-pc-open").click();
    expect(open).not.toHaveBeenCalled();
    expect(row.querySelector(".mej-cc-pc-open").textContent).toBe("Unknown entry");
  });
  it("empty state and Add connection", () => {
    const add = vi.fn();
    const root = build([], { canAdd: true }, { add });
    expect(root.querySelector(".mej-cc-pc-empty").textContent).toBe("No player connections yet.");
    root.querySelector(".mej-cc-pc-add").click();
    expect(add).toHaveBeenCalledOnce();
    expect(build([], { canAdd: false }, { add }).querySelector(".mej-cc-pc-add")).toBeNull();
    expect(build([], { canAdd: true }).querySelector(".mej-cc-pc-add")).toBeNull();
  });
  it("clicking the name opens the other entry", () => {
    const open = vi.fn();
    build([{ view: view(), target: mara }], {}, { open }).querySelector(".mej-cc-pc-open").click();
    expect(open).toHaveBeenCalledWith("JournalEntry.mara");
  });
});

describe("buildConnectionsBlock - editing (spec §4.5)", () => {
  const editable = () => view({ isAuthor: true, showAuthor: false, viewerId: "u1",
    main: note({ writerId: "u1", authorName: "Dana", label: "Sister of", secret: "owes", secretVisible: true, editable: true, canReveal: true, canDelete: true }) });

  it("the writer gets inputs that save on change, debounced", () => {
    vi.useFakeTimers();
    const saveNote = vi.fn();
    const v = editable();
    const root = build([{ view: v, target: mara }], {}, { saveNote });
    const label = root.querySelector("input.mej-cc-pc-label-input");
    const secret = root.querySelector("input.mej-cc-pc-secret-input");
    expect(label.value).toBe("Sister of");
    expect(secret.value).toBe("owes");
    label.value = "Twin of";
    label.dispatchEvent(new Event("change", { bubbles: true }));
    secret.dispatchEvent(new Event("change", { bubbles: true }));
    expect(saveNote).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(saveNote).toHaveBeenCalledOnce();
    expect(saveNote).toHaveBeenCalledWith(v, { label: "Twin of", secret: "owes" });
  });
  it("change/input never reach MEJ's submitOnChange form; Enter blurs instead of submitting (Review Focus 5)", () => {
    const form = document.createElement("form");
    const seen = vi.fn();
    form.addEventListener("change", seen);
    form.addEventListener("input", seen);
    const root = build([{ view: editable(), target: mara }], {}, { saveNote: vi.fn() });
    form.append(root);
    const label = root.querySelector("input.mej-cc-pc-label-input");
    label.dispatchEvent(new Event("input", { bubbles: true }));
    label.dispatchEvent(new Event("change", { bubbles: true }));
    expect(seen).not.toHaveBeenCalled();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    label.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
  });
  it("no inputs without a saveNote handler or for someone else's note", () => {
    expect(build([{ view: editable(), target: mara }]).querySelector("input")).toBeNull();
    expect(build([{ view: view({ others: [note()] }), target: mara }], {}, { saveNote: vi.fn() }).querySelector("input")).toBeNull();
  });
  it("Reveal/Hide for the writer's secret", () => {
    const toggleReveal = vi.fn();
    const v = editable();
    const root = build([{ view: v, target: mara }], {}, { saveNote: vi.fn(), toggleReveal });
    const btn = root.querySelector(".mej-cc-pc-reveal");
    expect(btn.textContent.trim()).toBe("Reveal");
    btn.click();
    expect(toggleReveal).toHaveBeenCalledWith(v, v.main);
    const revealed = view({ main: { ...editable().main, revealed: true } });
    expect(build([{ view: revealed, target: mara }], {}, { saveNote: vi.fn(), toggleReveal }).querySelector(".mej-cc-pc-reveal").textContent.trim()).toBe("Hide");
    const noSecret = view({ main: { ...editable().main, canReveal: false } });
    expect(build([{ view: noSecret, target: mara }], {}, { saveNote: vi.fn(), toggleReveal }).querySelector(".mej-cc-pc-reveal")).toBeNull();
  });
  it("share toggle and delete for the author; state icon for everyone else", () => {
    const toggleShare = vi.fn();
    const deleteConnection = vi.fn();
    const v = view({ canToggleShare: true, canDelete: true });
    const root = build([{ view: v, target: mara }], {}, { toggleShare, deleteConnection });
    root.querySelector(".mej-cc-pc-share").click();
    root.querySelector(".mej-cc-pc-delete").click();
    expect(toggleShare).toHaveBeenCalledWith(v);
    expect(deleteConnection).toHaveBeenCalledWith(v);
    const other = build([{ view: view(), target: mara }], {}, { toggleShare, deleteConnection });
    expect(other.querySelector(".mej-cc-pc-share")).toBeNull();
    expect(other.querySelector(".mej-cc-pc-delete")).toBeNull();
    expect(other.querySelector(".mej-cc-pc-share-state")).not.toBeNull();
  });
  it("note delete for its writer or the GM", () => {
    const deleteNote = vi.fn();
    const n = note({ canDelete: true });
    const v = view({ others: [n] });
    build([{ view: v, target: mara }], {}, { deleteNote }).querySelector(".mej-cc-pc-note-delete").click();
    expect(deleteNote).toHaveBeenCalledWith(v, n);
  });
  it("Add a note opens an inline draft that saves through saveNote", () => {
    vi.useFakeTimers();
    const saveNote = vi.fn();
    const v = view({ canAddNote: true, viewerId: "u3" });
    const root = build([{ view: v, target: mara }], {}, { saveNote });
    root.querySelector(".mej-cc-pc-add-note").click();
    expect(root.querySelector(".mej-cc-pc-add-note")).toBeNull();
    const draft = root.querySelector('li.mej-cc-pc-note.new[data-writer-id="u3"]');
    expect(draft.querySelector(".mej-cc-pc-writer").textContent).toBe("Me");
    const input = draft.querySelector("input.mej-cc-pc-label-input");
    input.value = "half-sister, actually";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(saveNote).toHaveBeenCalledWith(v, { label: "half-sister, actually", secret: "" });
  });
});

describe("buildConnectionsBlock - drop", () => {
  it("calls drop and stops the event; no drop target without the handler", () => {
    const drop = vi.fn();
    const root = build([], {}, { drop });
    const outer = vi.fn();
    const wrap = document.createElement("div");
    wrap.addEventListener("drop", outer);
    wrap.append(root);
    const event = new Event("drop", { bubbles: true, cancelable: true });
    root.dispatchEvent(event);
    expect(drop).toHaveBeenCalledWith(event);
    expect(event.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    build([]).dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
  });
});

describe("groupSideViews", () => {
  it("groups by target type, sorts rows by name and groups by label, defunct last", () => {
    const groups = groupSideViews([
      { view: view({ id: "b" }), target: { ...mara, name: "Zed" } },
      { view: view({ id: "a" }), target: { ...mara, name: "Abe" } },
      { view: view({ id: "q" }), target: { ...mara, name: "Hunt", type: "quest" } },
      { view: view({ id: "x" }), target: null }
    ], { typeLabel: (t) => ({ person: "Person", quest: "Quest", defunct: "Unknown" })[t] });
    expect(groups.map((g) => g.name)).toEqual(["Person", "Quest", "Unknown"]);
    expect(groups[0].rows.map((r) => r.view.id)).toEqual(["a", "b"]);
  });
});

describe("buildConnectionsBlock - keyboard operability", () => {
  it("controls are real <button type=button> elements so Enter/Space activate them and they never submit MEJ's form", () => {
    const root = build([{ view: view({ canToggleShare: true, canDelete: true, canAddNote: true, others: [note({ canDelete: true })] }), target: mara }],
      { canAdd: true }, { add: vi.fn(), toggleShare: vi.fn(), deleteConnection: vi.fn(), deleteNote: vi.fn(), saveNote: vi.fn() });
    for (const sel of [".mej-cc-pc-add", ".mej-cc-pc-share", ".mej-cc-pc-delete", ".mej-cc-pc-note-delete", ".mej-cc-pc-add-note"]) {
      const c = root.querySelector(sel);
      expect(c.tagName, sel).toBe("BUTTON");
      expect(c.type, sel).toBe("button");
    }
  });
  it("the name link is keyboard-focusable (href) and opens on activation", () => {
    const open = vi.fn();
    const link = build([{ view: view(), target: mara }], {}, { open }).querySelector(".mej-cc-pc-open");
    expect(link.getAttribute("href")).toBe("#");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("JournalEntry.mara");
  });
});
