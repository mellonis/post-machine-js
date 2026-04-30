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
