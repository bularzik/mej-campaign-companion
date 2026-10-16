import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClickGate, FOCUS_DELAY_MS } from "../scripts/logic/graph-click.mjs";

describe("createClickGate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const onFocus = vi.fn(); const onOpen = vi.fn();
    return { onFocus, onOpen, gate: createClickGate({ onFocus, onOpen }) };
  };

  it("a single click focuses after the delay", () => {
    const { gate, onFocus } = make();
    gate.click("E.1");
    expect(onFocus).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FOCUS_DELAY_MS);
    expect(onFocus).toHaveBeenCalledWith("E.1");
  });
  it("a double-click opens and never focuses, even when slow", () => {
    const { gate, onFocus, onOpen } = make();
    gate.click("E.1", { detail: 1 });
    vi.advanceTimersByTime(FOCUS_DELAY_MS - 50);
    gate.click("E.1", { detail: 2 });
    gate.dblclick("E.1");
    vi.advanceTimersByTime(1000);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onFocus).not.toHaveBeenCalled();
  });
  it("a modifier click opens immediately", () => {
    const { gate, onFocus, onOpen } = make();
    gate.click("E.1", { modifier: true });
    vi.advanceTimersByTime(1000);
    expect(onOpen).toHaveBeenCalledWith("E.1");
    expect(onFocus).not.toHaveBeenCalled();
  });
  it("cancel drops a pending focus (redraw / close)", () => {
    const { gate, onFocus } = make();
    gate.click("E.1");
    gate.cancel();
    vi.advanceTimersByTime(1000);
    expect(onFocus).not.toHaveBeenCalled();
  });
  it("without onFocus a click opens", () => {
    const onOpen = vi.fn();
    createClickGate({ onOpen }).click("E.1");
    expect(onOpen).toHaveBeenCalledWith("E.1");
  });
});
