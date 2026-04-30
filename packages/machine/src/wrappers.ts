import {
  type EquivalenceCase,
  type EquivalenceReport,
  type GraphSummary,
  equivalentOn,
  summarize,
} from '@turing-machine-js/machine';
import type { PostMachine } from './classes/PostMachine';

// Post-aware sugar around the upstream introspection / equivalence utilities.
// They delegate directly — no behavior added — but spare the caller from
// passing `machine.initialState` and `machine.tapeBlock` (and, for
// equivalentOn, from getting the per-call tapeBlock factory exactly right).

/**
 * Sugar for `summarize(machine.initialState, machine.tapeBlock)`.
 */
export function summarizePostMachine(machine: PostMachine): GraphSummary {
  return summarize(machine.initialState, machine.tapeBlock);
}

/**
 * Sugar for `equivalentOn` against two `PostMachine` instances. The
 * `getTapeBlock` factory MUST clone the originating PostMachine's tapeBlock
 * (PostMachine state-graph symbols are interned per-block; a fresh
 * `TapeBlock.fromAlphabets([alphabet])` would not match). This wrapper hides
 * that ceremony.
 */
export function equivalentPostMachines(
  reference: PostMachine,
  candidate: PostMachine,
  cases: EquivalenceCase[],
  options?: Parameters<typeof equivalentOn>[3],
): EquivalenceReport {
  return equivalentOn(
    { state: reference.initialState, getTapeBlock: () => reference.tapeBlock.clone() },
    { state: candidate.initialState, getTapeBlock: () => candidate.tapeBlock.clone() },
    cases,
    options,
  );
}
