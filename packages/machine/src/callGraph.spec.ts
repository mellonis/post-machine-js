import {describe, expect, test} from 'vitest';

import {analyzeLocalCallGraph} from './callGraph';
import {call, mark, stop} from './commands';

// Direct unit tests for the call-graph analyzer (#85). The full PostMachine
// integration tests (`machine.spec.ts`, `naming.spec.ts`, `examples.spec.ts`)
// exercise the analyzer indirectly through `new PostMachine(...)`, but those
// fixtures rarely hit the cyclic-SCC paths. These tests poke the algorithm
// directly to keep branch coverage at the repo's hard floor (100).

describe('analyzeLocalCallGraph', () => {
  test('empty input → no cyclic subs, no build order', () => {
    const {cyclicSet, buildOrder} = analyzeLocalCallGraph({});

    expect(cyclicSet.size).toBe(0);
    expect(buildOrder).toEqual([]);
  });

  test('acyclic chain a → b → c → halt', () => {
    const {cyclicSet, buildOrder} = analyzeLocalCallGraph({
      a: {1: call('b'), 2: stop},
      b: {1: call('c'), 2: stop},
      c: {1: mark},
    });

    expect(cyclicSet.size).toBe(0);
    // Build order is reverse-topological: sinks first. So c (no outgoing
    // local calls) appears before b, and b before a.
    expect(buildOrder.indexOf('c')).toBeLessThan(buildOrder.indexOf('b'));
    expect(buildOrder.indexOf('b')).toBeLessThan(buildOrder.indexOf('a'));
  });

  test('mutual recursion a ↔ b — both marked cyclic', () => {
    const {cyclicSet, buildOrder} = analyzeLocalCallGraph({
      a: {1: call('b'), 2: stop},
      b: {1: call('a'), 2: stop},
    });

    expect(cyclicSet.has('a')).toBe(true);
    expect(cyclicSet.has('b')).toBe(true);
    expect(buildOrder).toContain('a');
    expect(buildOrder).toContain('b');
  });

  test('self-recursion a → a — marked cyclic', () => {
    const {cyclicSet} = analyzeLocalCallGraph({
      a: {1: call('a'), 2: stop},
    });

    expect(cyclicSet.has('a')).toBe(true);
  });

  test('mixed: acyclic leaf + cyclic pair', () => {
    const {cyclicSet} = analyzeLocalCallGraph({
      a: {1: call('b'), 2: call('leaf'), 3: stop},
      b: {1: call('a'), 2: stop},
      leaf: {1: mark},
    });

    expect(cyclicSet.has('a')).toBe(true);
    expect(cyclicSet.has('b')).toBe(true);
    expect(cyclicSet.has('leaf')).toBe(false);
  });

  test('edges to non-local subs are leaf edges (no cycle detected)', () => {
    // 'a' calls 'external' which isn't in the local map. The analyzer treats
    // external as a leaf — no edge contributes to local cycle detection.
    const {cyclicSet} = analyzeLocalCallGraph({
      a: {1: call('external'), 2: stop},
    });

    expect(cyclicSet.size).toBe(0);
  });

  test('handles null instruction bodies without throwing', () => {
    // PostMachine's downstream validation catches malformed inputs; the
    // analyzer must not throw on them.
    expect(() => analyzeLocalCallGraph({a: null as never})).not.toThrow();

    const {cyclicSet} = analyzeLocalCallGraph({a: null as never});

    expect(cyclicSet.size).toBe(0);
  });

  test('calls inside groups are also extracted', () => {
    // `call` inside a group throws at PostMachine construction (per the
    // group rules), but the analyzer is tolerant and walks group arrays so
    // it can still classify malformed-but-syntactically-parsed inputs.
    const {cyclicSet} = analyzeLocalCallGraph({
      a: {1: [mark, call('a')] as never, 2: stop},
    });

    expect(cyclicSet.has('a')).toBe(true);
  });

  test('3-node cycle a → b → c → a', () => {
    // Exercises the SCC algorithm's multi-element scc emit path.
    const {cyclicSet, buildOrder} = analyzeLocalCallGraph({
      a: {1: call('b'), 2: stop},
      b: {1: call('c'), 2: stop},
      c: {1: call('a'), 2: stop},
    });

    expect(cyclicSet.has('a')).toBe(true);
    expect(cyclicSet.has('b')).toBe(true);
    expect(cyclicSet.has('c')).toBe(true);
    // All three end up in the same SCC (consecutive in build order).
    expect(buildOrder.length).toBe(3);
  });

  test('non-function non-array number-keyed values are ignored', () => {
    // Defensive: a string under a number key isn't a command. PostMachine's
    // constructor catches this downstream; the analyzer just walks past it
    // without contributing any edges.
    const {cyclicSet} = analyzeLocalCallGraph({
      a: {1: 'not a command' as never, 2: stop},
    });

    expect(cyclicSet.size).toBe(0);
  });

  test('cross edges (target already in a finished SCC) are ignored', () => {
    // Graph: a→b, a→c, b→c. DFS from a visits b first (pushes), b→c (pushes
    // c, c has no outgoing, c is its own SCC, pop). Back to b, b's SCC pops.
    // Back to a, a→c: c is already indexed AND not on the stack → cross
    // edge to a finished SCC. The analyzer ignores it. None of these are
    // cycles, so cyclicSet stays empty.
    const {cyclicSet} = analyzeLocalCallGraph({
      a: {1: call('b'), 2: call('c'), 3: stop},
      b: {1: call('c'), 2: stop},
      c: {1: mark},
    });

    expect(cyclicSet.size).toBe(0);
  });
});
