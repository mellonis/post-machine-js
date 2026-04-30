// Non-README v3 tests — sentinel identity of re-exports, getter sanity,
// equivalentOn end-to-end. README-driven tests live in examples.spec.ts
// (one per README — root tests in <repo>/test/examples.spec.ts, per-package
// tests in <package>/test/examples.spec.ts).

import {
  PostMachine,
  State as PostState,
  toMermaid as postToMermaid,
  fromMermaid as postFromMermaid,
  summarize as postSummarize,
  summarizeGraph as postSummarizeGraph,
  equivalentOn as postEquivalentOn,
  check, mark, right, stop,
} from '../src/index';
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
