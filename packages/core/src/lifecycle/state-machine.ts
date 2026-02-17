/**
 * Runtime state machine for Personal Server lifecycle.
 *
 * States:
 * - uninitialized: Process started, nothing configured
 * - starting: Config loaded, dependencies initializing
 * - ready-local: HTTP listener up, no owner auth yet
 * - ready-authenticated: Owner key derived, tunnel + sync active
 * - shutting-down: Graceful shutdown in progress
 * - stopped: All resources released
 * - error: Unrecoverable error from any state
 */

export type RuntimeState =
  | "uninitialized"
  | "starting"
  | "ready-local"
  | "ready-authenticated"
  | "shutting-down"
  | "stopped"
  | "error";

/** Valid state transitions. Each key maps to the set of states it can transition to. */
const VALID_TRANSITIONS: Record<RuntimeState, ReadonlySet<RuntimeState>> = {
  uninitialized: new Set(["starting", "error"]),
  starting: new Set(["ready-local", "error"]),
  "ready-local": new Set(["ready-authenticated", "shutting-down", "error"]),
  "ready-authenticated": new Set(["shutting-down", "error"]),
  "shutting-down": new Set(["stopped", "error"]),
  stopped: new Set(),
  error: new Set(["starting", "stopped"]),
};

export interface StateTransitionEvent {
  from: RuntimeState;
  to: RuntimeState;
  timestamp: Date;
  reason?: string;
}

export type StateChangeListener = (event: StateTransitionEvent) => void;

export class RuntimeStateMachine {
  private state: RuntimeState = "uninitialized";
  private listeners: StateChangeListener[] = [];

  /** Get the current state. */
  getState(): RuntimeState {
    return this.state;
  }

  /** Check whether a transition to the target state is valid. */
  canTransition(to: RuntimeState): boolean {
    return VALID_TRANSITIONS[this.state].has(to);
  }

  /**
   * Transition to a new state.
   * Throws if the transition is not valid.
   */
  transition(to: RuntimeState, reason?: string): void {
    if (!this.canTransition(to)) {
      throw new Error(`Invalid state transition: ${this.state} -> ${to}`);
    }

    const event: StateTransitionEvent = {
      from: this.state,
      to,
      timestamp: new Date(),
      reason,
    };

    this.state = to;

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** Register a listener for state changes. Returns an unsubscribe function. */
  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }
}
