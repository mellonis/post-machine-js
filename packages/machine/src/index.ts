import type { MachineState as EngineMachineState } from '@turing-machine-js/machine';
import type { Path } from './path';

// Prior versions installed a module-load lockdown on the engine's haltState
// singleton (`installHaltLockdown`) that threw on every direct
// `haltState.debug = X` write. Dropped because:
//   - turing-machine-js#207 collapsed `haltState.debug` to a boolean, removing
//     the per-side `DebugConfig` API the lockdown was implicitly funneling.
//   - The "per-PostMachine routing" benefit was syntactic only — haltState is
//     a process-global singleton; pm.setBreakpoint(haltState, …) just wrote
//     the same global flag, didn't actually isolate per instance.
//   - Module-load side-effect leaked into Turing-only consumers that imported
//     post-machine-js purely for shared APIs but never constructed a
//     PostMachine — they were blocked from writing haltState.debug for no
//     benefit.
// State-level lockdown on PostMachine-constructed States is unaffected — that
// one DOES guard a real per-instance registry (#stateToCandidatePaths +
// #breakpoints) where direct writes would bypass arrival-path filtering.

export {
  Tape,
  State,
  toMermaid,
  fromMermaid,
  summarize,
  summarizeGraph,
  equivalentOn,
} from '@turing-machine-js/machine';
export type {
  Graph,
  GraphNode,
  GraphTransition,
  GraphCommand,
  GraphSummary,
  Runnable,
  EquivalenceCase,
  EquivalenceResult,
  EquivalenceReport,
} from '@turing-machine-js/machine';
export { alphabet, blankSymbol, markSymbol } from './consts';
export {
  $tag, call, check, erase, left, mark, noop, right, stop,
} from './commands';
export type {
  Instructions,
  CommandStateProducer,
  CommandConstructor,
  CommandContext,
} from './commands';
export { PostMachine } from './classes/PostMachine';
export type { PostMachineOptions } from './classes/PostMachine';
export {
  summarizePostMachine,
  equivalentPostMachines,
} from './wrappers';
export { parsePath, formatPath, type Path } from './path';
export type { Breakpoint, BreakpointFilter, BreakpointTarget } from './breakpoints';
export { haltState } from '@turing-machine-js/machine';

export type MachineState = EngineMachineState & {
  arrivalPath: Path;
  candidatePaths: Path[];
};
