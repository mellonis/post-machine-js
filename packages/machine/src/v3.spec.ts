// Non-README v3 tests — sentinel identity of re-exports, getter sanity,
// equivalentOn end-to-end, and wrapper-vs-manual-call equivalence.
// README-driven tests live in examples.spec.ts (one per README — root tests
// in <repo>/test/examples.spec.ts, per-package tests in
// <package>/test/examples.spec.ts).

import {
  PostMachine,
  State as PostState,
  toMermaid as postToMermaid,
  fromMermaid as postFromMermaid,
  summarize as postSummarize,
  summarizeGraph as postSummarizeGraph,
  equivalentOn as postEquivalentOn,
  summarizePostMachine,
  equivalentPostMachines,
  check, mark, right, stop,
} from './index';
import {
  State as TuringState,
  toMermaid as turingToMermaid,
  fromMermaid as turingFromMermaid,
  summarize as turingSummarize,
  summarizeGraph as turingSummarizeGraph,
  equivalentOn as turingEquivalentOn,
} from '@turing-machine-js/machine';

describe('v3 re-exports — sentinel identity', () => {
  // The peer-dep model means the re-export must resolve to the same instance
  // as the upstream import. Otherwise instanceof checks across the boundary
  // (haltState identity, sentinel symbols, etc.) would break.
  test('State is the same class', () => {
    expect(PostState).toBe(TuringState);
  });

  test('graph utilities are the same functions', () => {
    expect(postToMermaid).toBe(turingToMermaid);
    expect(postFromMermaid).toBe(turingFromMermaid);
  });

  test('introspection utilities are the same functions', () => {
    expect(postSummarize).toBe(turingSummarize);
    expect(postSummarizeGraph).toBe(turingSummarizeGraph);
  });

  test('equivalence utility is the same function', () => {
    expect(postEquivalentOn).toBe(turingEquivalentOn);
  });
});

describe('PostMachine v3 surface', () => {
  let machine: PostMachine;

  beforeAll(() => {
    machine = new PostMachine({
      10: check(20, 30),
      20: right(10),
      30: mark,
      40: stop,
    });
  });

  test('initialState getter returns a State', () => {
    expect(machine.initialState).toBeInstanceOf(PostState);
  });
});

describe('equivalentOn end-to-end with PostMachine', () => {
  function buildWalkAndMark(): PostMachine {
    return new PostMachine({
      10: check(20, 30),
      20: right(10),
      30: mark,
      40: stop,
    });
  }

  function buildWalkAndDoNothing(): PostMachine {
    return new PostMachine({
      10: check(20, 30),
      20: right(10),
      30: stop,
    });
  }

  test('two identical PostMachine programs agree', () => {
    const a = buildWalkAndMark();
    const b = buildWalkAndMark();

    const report = postEquivalentOn(
      { state: a.initialState, getTapeBlock: () => a.tapeBlock.clone() },
      { state: b.initialState, getTapeBlock: () => b.tapeBlock.clone() },
      ['** '],
    );

    expect(report.allAgree).toBe(true);
  });

  test('a divergent PostMachine disagrees', () => {
    const reference = buildWalkAndMark();
    const candidate = buildWalkAndDoNothing();

    const report = postEquivalentOn(
      { state: reference.initialState, getTapeBlock: () => reference.tapeBlock.clone() },
      { state: candidate.initialState, getTapeBlock: () => candidate.tapeBlock.clone() },
      ['** '],
    );

    expect(report.allAgree).toBe(false);
    expect(report.results[0].referenceOutput).toBe('***');
    expect(report.results[0].candidateOutput).toBe('**');
  });
});

describe('Post-aware wrappers — equivalence to manual upstream calls', () => {
  function buildWalkAndMark(): PostMachine {
    return new PostMachine({
      10: check(20, 30),
      20: right(10),
      30: mark,
      40: stop,
    });
  }

  test('summarizePostMachine matches summarize(initialState, tapeBlock)', () => {
    const machine = buildWalkAndMark();

    expect(summarizePostMachine(machine))
      .toEqual(postSummarize(machine.initialState, machine.tapeBlock));
  });

  test('equivalentPostMachines matches equivalentOn with clone-based getTapeBlock', () => {
    const reference = buildWalkAndMark();
    const candidate = buildWalkAndMark();

    const wrapped = equivalentPostMachines(reference, candidate, ['** ']);
    const manual = postEquivalentOn(
      { state: reference.initialState, getTapeBlock: () => reference.tapeBlock.clone() },
      { state: candidate.initialState, getTapeBlock: () => candidate.tapeBlock.clone() },
      ['** '],
    );

    // Both should agree (identical machines on identical input). The reports
    // contain step counts and snapshots that are deterministic for fresh runs,
    // so toEqual on the full structure is fair.
    expect(wrapped.allAgree).toBe(true);
    expect(manual.allAgree).toBe(true);
    expect(wrapped.results[0].referenceOutput).toBe(manual.results[0].referenceOutput);
    expect(wrapped.results[0].candidateOutput).toBe(manual.results[0].candidateOutput);
    expect(wrapped.results[0].referenceSteps).toBe(manual.results[0].referenceSteps);
    expect(wrapped.results[0].candidateSteps).toBe(manual.results[0].candidateSteps);
  });

  test('equivalentPostMachines passes through options to upstream equivalentOn', () => {
    const reference = buildWalkAndMark();
    const candidate = buildWalkAndMark();

    // compareOutputs that always returns false → wrapper should report disagreement.
    const report = equivalentPostMachines(reference, candidate, ['** '], {
      compareOutputs: () => false,
    });

    expect(report.allAgree).toBe(false);
  });
});
