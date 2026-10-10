// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { debounce, DEBOUNCE_MS, trackEditing, shouldKeepBlock } from "../scripts/apps/inline-edit.mjs";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("debounce", () => {
  it("runs once, DEBOUNCE_MS after the last call, with the last arguments", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn);
    d("a");
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    d("b");
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("b");
  });
  it("takes a custom delay", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    debounce(fn, 10)();
    vi.advanceTimersByTime(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("trackEditing - a re-render never wipes text being typed", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  function setup() {
    const block = document.createElement("section");
    block.innerHTML = '<input class="a" value="abc"><button type="button">x</button>'
      + '<ol><li><div class="mej-cc-party-line new"><input class="draft"></div></li></ol>';
    const outside = document.createElement("input");
    document.body.append(block, outside);
    const onSettled = vi.fn();
    return { block, outside, onSettled, tracker: trackEditing(block, onSettled) };
  }

  it("a focused text field is an edit in progress; moving focus out settles it", async () => {
    const { block, outside, onSettled, tracker } = setup();
    expect(tracker.editing()).toBe(false);
    block.querySelector("input.a").focus();
    expect(tracker.editing()).toBe(true);
    outside.focus();
    await tick();
    expect(tracker.editing()).toBe(false);
    expect(onSettled).toHaveBeenCalled();
  });
  it("focus on a button is not an edit (its click result should show at once)", () => {
    const { block, tracker } = setup();
    block.querySelector("button").focus();
    expect(tracker.editing()).toBe(false);
  });
  it("being removed by a re-render does not count as leaving; restoreFocus puts the caret back", async () => {
    const { block, onSettled, tracker } = setup();
    const input = block.querySelector("input.a");
    input.focus();
    input.setSelectionRange(1, 2);
    block.remove();
    // jsdom fires nothing on removal; some browsers fire focusout - cover that.
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await tick();
    expect(tracker.editing()).toBe(true);
    expect(onSettled).not.toHaveBeenCalled();
    document.body.append(block);
    tracker.restoreFocus();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 2]);
  });
  it("a new-line draft holding unsent text is an edit until its change event sends it", async () => {
    const { block, onSettled, tracker } = setup();
    const draft = block.querySelector("input.draft");
    draft.value = "Owes me";
    draft.dispatchEvent(new Event("input", { bubbles: true }));
    expect(tracker.editing()).toBe(true);
    draft.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(tracker.editing()).toBe(false);
    expect(onSettled).toHaveBeenCalled();
  });
  it("a draft typed into and cleared back to empty is not an edit once focus leaves (no change event fires)", async () => {
    const { block, outside, onSettled, tracker } = setup();
    const draft = block.querySelector("input.draft");
    draft.focus();
    draft.value = "O";
    draft.dispatchEvent(new Event("input", { bubbles: true }));
    draft.value = "";
    draft.dispatchEvent(new Event("input", { bubbles: true }));
    outside.focus();
    await tick();
    expect(tracker.editing()).toBe(false);
    expect(onSettled).toHaveBeenCalled();
  });
});

describe("shouldKeepBlock", () => {
  it("keeps the live block only for the same page while an edit is in progress", () => {
    expect(shouldKeepBlock({ prevPageUuid: "P1", pageUuid: "P1", editing: true })).toBe(true);
    expect(shouldKeepBlock({ prevPageUuid: "P1", pageUuid: "P1", editing: false })).toBe(false);
    expect(shouldKeepBlock({ prevPageUuid: "P1", pageUuid: "P2", editing: true })).toBe(false);
    expect(shouldKeepBlock({ prevPageUuid: undefined, pageUuid: "P1", editing: true })).toBe(false);
  });
});
