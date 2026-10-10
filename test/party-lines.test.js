// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildPartyLine, buildPartyRow, buildAddButton, placeLines, dropMode, isolatePartyEdits, carryList, DETACHED_FORM
} from "../scripts/apps/party-lines.mjs";
import { DEBOUNCE_MS, trackEditing, shouldKeepBlock } from "../scripts/apps/inline-edit.mjs";

const labels = {
  party: "Party", addLabel: "Party: add a label", edited: (n) => `edited by ${n}`,
  remove: "Remove party relationship", add: "Add relationship", fallbackImg: "fallback.svg"
};
const line = (over = {}) => ({ notebookUuid: "JournalEntry.nb", key: "k1", campaignName: "", other: "JournalEntry.m",
  side: "a", label: "Sister of", otherLabel: "", editedName: "Jo", ...over });

afterEach(() => vi.useRealTimers());

describe("buildPartyLine", () => {
  it("read-only: text, no input, no delete; label is text not HTML", () => {
    const el = buildPartyLine(document, { line: line({ label: "<b>x</b>" }), editable: false, labels }, {});
    expect(el.querySelector("input")).toBeNull();
    expect(el.querySelector(".mej-cc-party-label").textContent).toBe("<b>x</b>");
    expect(el.querySelector(".mej-cc-party-delete")).toBeNull();
    expect(el.querySelector(".mej-cc-party-edited").textContent).toBe("edited by Jo");
  });
  it("editable: debounced save with the side and value", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const el = buildPartyLine(document, { line: line(), editable: true, labels }, { save });
    const input = el.querySelector("input");
    input.value = "Rival";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    expect(save).toHaveBeenCalledWith(line(), "Rival");
  });
  it("editable: delete calls remove", () => {
    const remove = vi.fn();
    const el = buildPartyLine(document, { line: line(), editable: true, labels }, { remove });
    el.querySelector(".mej-cc-party-delete").click();
    expect(remove).toHaveBeenCalledWith(line());
  });
  it("an empty-placeholder line (no row yet) creates on first input", () => {
    vi.useFakeTimers();
    const create = vi.fn();
    const el = buildPartyLine(document, { line: null, editable: true, labels }, { create });
    expect(el.classList.contains("new")).toBe(true);
    expect(el.querySelector("input").placeholder).toBe("Party: add a label");
    el.querySelector("input").value = "Ally";
    el.querySelector("input").dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    expect(create).toHaveBeenCalledWith("Ally");
  });
  it("shows the campaign name when the line carries one", () => {
    const el = buildPartyLine(document, { line: line({ campaignName: "Red" }), editable: false, labels }, {});
    expect(el.querySelector(".mej-cc-party-campaign").textContent).toBe("Red");
  });
});

describe("buildPartyRow", () => {
  it("MEJ row classes, image, clickable name, party line inside", () => {
    const open = vi.fn();
    const li = buildPartyRow(document, {
      line: line(), target: { uuid: "JournalEntry.m", name: "Mara", img: "m.png", type: "person" }, editable: false, labels
    }, { open });
    expect(li.matches("li.item.flexrow.mej-cc-party-only")).toBe(true);
    expect(li.dataset.uuid).toBe("JournalEntry.m");
    expect(li.querySelector("img.item-image.large").getAttribute("src")).toBe("m.png");
    li.querySelector(".item-name a").click();
    expect(open).toHaveBeenCalledWith("JournalEntry.m");
    expect(li.querySelector(".mej-cc-party-line")).not.toBeNull();
  });
});

describe("placeLines (Review Focus 4)", () => {
  it("lines under a GM row go into that row; party-only rows go into their type group", () => {
    document.body.innerHTML = `<ol class="item-list">
      <li><header><div class="name">Person</div></header></li>
      <li class="item" data-uuid="JournalEntry.g"><div class="item-relationship"></div></li>
    </ol>`;
    const list = document.querySelector("ol");
    const built = [];
    placeLines(list, [line({ other: "JournalEntry.g" }), line({ other: "JournalEntry.m", key: "k2" })], {
      gmRowFor: (uuid) => list.querySelector(`li.item[data-uuid="${uuid}"]`),
      typeOf: () => "person",
      groupHeader: () => list.querySelector("li:first-child"),
      buildLine: (l) => { const d = document.createElement("div"); d.className = "line"; built.push(l.key); return d; },
      buildRow: (l) => { const li = document.createElement("li"); li.className = "party-only"; li.dataset.key = l.key; return li; }
    });
    expect(list.querySelector('li[data-uuid="JournalEntry.g"] .item-relationship .line')).not.toBeNull();
    expect(list.querySelector("li.party-only").previousElementSibling.dataset.uuid).toBe("JournalEntry.g");
  });
});

describe("dropMode (Review Focus 3)", () => {
  it("GM and entry owners keep MEJ's drop", () => {
    expect(dropMode({ isGM: true, isOwner: false, canAdd: true })).toBe("mej");
    expect(dropMode({ isGM: false, isOwner: true, canAdd: true })).toBe("mej");
  });
  it("other writers get the party drop; non-writers none", () => {
    expect(dropMode({ isGM: false, isOwner: false, canAdd: true })).toBe("party");
    expect(dropMode({ isGM: false, isOwner: false, canAdd: false })).toBe("none");
  });
});

describe("buildAddButton", () => {
  it("click calls back", () => {
    const onClick = vi.fn();
    buildAddButton(document, { labels }, onClick).querySelector("button").click();
    expect(onClick).toHaveBeenCalled();
  });
});

// MEJ's sheet is a submitOnChange <form>, and a non-editable sheet's
// _toggleDisabled sweeps form.elements: party controls must not be form-owned
// and their change/input must not reach the form (0.25.0 lessons).
describe("party controls stay out of MEJ's form", () => {
  it("inputs and buttons are detached from any form; Enter blurs instead of submitting", () => {
    const line = buildPartyLine(document, { line: null, editable: true, labels }, {});
    const add = buildAddButton(document, { labels }, () => {});
    expect(line.querySelector("input").getAttribute("form")).toBe(DETACHED_FORM);
    expect(add.querySelector("button").getAttribute("form")).toBe(DETACHED_FORM);
    const form = document.createElement("form");
    form.append(line, add);
    document.body.append(form);
    expect([...form.elements]).toEqual([]);
    const input = line.querySelector("input");
    input.focus();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(input);
  });
  it("isolatePartyEdits: party change/input stop at the list (list listeners still see them); MEJ's own fields bubble", () => {
    document.body.innerHTML = `<form><ol class="item-list"><li class="item">
      <div class="item-relationship"><input class="mej" name="x"></div></li></ol></form>`;
    const form = document.querySelector("form");
    const list = document.querySelector("ol");
    const atList = vi.fn();
    const atForm = vi.fn();
    list.addEventListener("change", atList);
    form.addEventListener("change", atForm);
    isolatePartyEdits(list);
    list.querySelector(".item-relationship").append(buildPartyLine(document, { line: line(), editable: true, labels }, {}));
    list.querySelector(".mej-cc-party-input").dispatchEvent(new Event("change", { bubbles: true }));
    expect(atList).toHaveBeenCalledTimes(1);
    expect(atForm).not.toHaveBeenCalled();
    list.querySelector("input.mej").dispatchEvent(new Event("change", { bubbles: true }));
    expect(atForm).toHaveBeenCalledTimes(1);
  });
});

// R3 / Review Focus 2: a save re-renders the sheet; the live list (and the
// caret) is carried into the fresh tab while the edit is in progress.
describe("carryList (edit carried across a re-render)", () => {
  const tab = (inner) => {
    const t = document.createElement("div");
    t.className = "tab";
    t.innerHTML = `<div class="relationships flexrow"><div class="items-list scrollable">${inner}</div></div>`;
    document.body.append(t);
    return t;
  };

  it("puts the previous list in place of MEJ's fresh one and restores focus and caret", () => {
    const old = tab('<ol class="item-list"><li class="item" data-uuid="J.g"><div class="item-relationship"></div></li></ol>');
    const list = old.querySelector("ol");
    list.querySelector(".item-relationship").append(buildPartyLine(document, { line: line(), editable: true, labels }, {}));
    const tracker = trackEditing(list, () => {});
    const input = list.querySelector("input");
    input.focus();
    input.setSelectionRange(2, 3);
    expect(shouldKeepBlock({ prevPageUuid: "P1", pageUuid: "P1", editing: tracker.editing() })).toBe(true);
    old.remove(); // MEJ replaced the tab
    const fresh = tab('<ol class="item-list"><li class="item fresh"></li></ol>');
    expect(carryList(fresh, { list, tracker })).toBe(true);
    const container = fresh.querySelector(".items-list");
    expect(container.querySelectorAll("ol.item-list")).toHaveLength(1);
    expect(container.querySelector("ol.item-list")).toBe(list);
    expect(fresh.querySelector("li.fresh")).toBeNull();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 3]);
  });
  it("replaces MEJ's empty-state instruction too", () => {
    const list = document.createElement("ol");
    list.className = "item-list";
    const fresh = tab('<div class="instruction">No relationships</div>');
    carryList(fresh, { list, tracker: trackEditing(list, () => {}) });
    expect(fresh.querySelector(".instruction")).toBeNull();
    expect(fresh.querySelector(".items-list > ol.item-list")).toBe(list);
  });
  it("no relationships container: nothing carried", () => {
    const list = document.createElement("ol");
    const bare = document.createElement("div");
    expect(carryList(bare, { list, tracker: trackEditing(list, () => {}) })).toBe(false);
  });
});
