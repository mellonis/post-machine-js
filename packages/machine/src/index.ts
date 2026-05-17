import { haltState as engineHaltState, type MachineState as EngineMachineState } from '@turing-machine-js/machine';
import type { Path } from './path';
import { installHaltLockdown } from './lockdown';

// Install lockdown on the engine's haltState singleton at module load. Direct
// `haltState.debug = X` writes throw; only pm.setBreakpoint(haltState, …) can
// modify it (via withLockdownEscape internally).
installHaltLockdown(engineHaltState);

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
  call, check, erase, left, mark, noop, right, stop,
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
