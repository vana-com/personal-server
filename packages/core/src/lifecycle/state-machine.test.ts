import { describe, it, expect, vi } from "vitest";
import {
  RuntimeStateMachine,
  type StateTransitionEvent,
} from "./state-machine.js";

describe("RuntimeStateMachine", () => {
  it("starts in uninitialized state", () => {
    const sm = new RuntimeStateMachine();
    expect(sm.getState()).toBe("uninitialized");
  });

  it("transitions through the happy path", () => {
    const sm = new RuntimeStateMachine();
    sm.transition("starting");
    expect(sm.getState()).toBe("starting");

    sm.transition("ready-local");
    expect(sm.getState()).toBe("ready-local");

    sm.transition("ready-authenticated");
    expect(sm.getState()).toBe("ready-authenticated");

    sm.transition("shutting-down");
    expect(sm.getState()).toBe("shutting-down");

    sm.transition("stopped");
    expect(sm.getState()).toBe("stopped");
  });

  it("allows transition to error from any non-terminal state", () => {
    for (const state of [
      "uninitialized",
      "starting",
      "ready-local",
      "ready-authenticated",
      "shutting-down",
    ] as const) {
      const sm = new RuntimeStateMachine();
      // Walk to the target state
      if (state === "starting") sm.transition("starting");
      if (state === "ready-local") {
        sm.transition("starting");
        sm.transition("ready-local");
      }
      if (state === "ready-authenticated") {
        sm.transition("starting");
        sm.transition("ready-local");
        sm.transition("ready-authenticated");
      }
      if (state === "shutting-down") {
        sm.transition("starting");
        sm.transition("ready-local");
        sm.transition("shutting-down");
      }

      expect(sm.canTransition("error")).toBe(true);
      sm.transition("error");
      expect(sm.getState()).toBe("error");
    }
  });

  it("rejects invalid transitions", () => {
    const sm = new RuntimeStateMachine();
    expect(sm.canTransition("ready-authenticated")).toBe(false);
    expect(() => sm.transition("ready-authenticated")).toThrow(
      "Invalid state transition: uninitialized -> ready-authenticated",
    );
  });

  it("does not allow transitions from stopped", () => {
    const sm = new RuntimeStateMachine();
    sm.transition("starting");
    sm.transition("ready-local");
    sm.transition("shutting-down");
    sm.transition("stopped");

    expect(sm.canTransition("starting")).toBe(false);
    expect(sm.canTransition("error")).toBe(false);
  });

  it("allows recovery from error to starting", () => {
    const sm = new RuntimeStateMachine();
    sm.transition("error");
    expect(sm.canTransition("starting")).toBe(true);
    sm.transition("starting");
    expect(sm.getState()).toBe("starting");
  });

  it("allows transition from error to stopped", () => {
    const sm = new RuntimeStateMachine();
    sm.transition("error");
    sm.transition("stopped");
    expect(sm.getState()).toBe("stopped");
  });

  it("notifies listeners on state change", () => {
    const sm = new RuntimeStateMachine();
    const events: StateTransitionEvent[] = [];
    sm.onStateChange((e) => events.push(e));

    sm.transition("starting", "boot");
    sm.transition("ready-local");

    expect(events).toHaveLength(2);
    expect(events[0].from).toBe("uninitialized");
    expect(events[0].to).toBe("starting");
    expect(events[0].reason).toBe("boot");
    expect(events[1].from).toBe("starting");
    expect(events[1].to).toBe("ready-local");
    expect(events[1].reason).toBeUndefined();
  });

  it("unsubscribes listener", () => {
    const sm = new RuntimeStateMachine();
    const listener = vi.fn();
    const unsub = sm.onStateChange(listener);

    sm.transition("starting");
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    sm.transition("ready-local");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("allows shutting down from ready-local (skipping auth)", () => {
    const sm = new RuntimeStateMachine();
    sm.transition("starting");
    sm.transition("ready-local");
    sm.transition("shutting-down");
    expect(sm.getState()).toBe("shutting-down");
  });
});
