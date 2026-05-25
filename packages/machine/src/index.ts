import type { MachineState as EngineMachineState } from '@turing-machine-js/machine';
import type { Path } from './path';

// haltState is intentionally NOT locked down — direct
// `haltState.debug = boolean` writes go to the engine
// setter (turing-machine-js#207). Per-PostMachine
// State lockdown is installed by PostMachine's
// constructor (see `installStateLockdown`).

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
