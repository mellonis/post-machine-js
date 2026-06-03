// Static call-graph analysis for PostMachine subroutines (#85).
//
// At construction time, PostMachine creates a "hopper" State per subroutine —
// a stub State that wraps a `Reference` to the subroutine's first instruction.
// The hopper exists because `withOverriddenHaltState` needs a real State to
// wrap, and at the moment `call('foo')` is invoked the subroutine's body may
// not have been built yet (forward-reference / mutual-recursion case).
//
// For SUBROUTINES THAT DON'T PARTICIPATE IN CYCLES, the hopper is dead weight:
// if we build callees before callers, the first-instruction State exists by
// the time `call(...)` runs, and we can wrap it directly. The hopper-based
// indirection only earns its keep when there's a true cycle that no build
// order can break (a calls b, b calls a; or a calls a).
//
// This module identifies which local subroutines participate in cycles, so
// the PostMachine constructor can:
//   1. Create hoppers ONLY for cyclic subroutines.
//   2. Process subroutines in a build order such that each acyclic
//      subroutine's callees (in the same scope) are built before it.
//
// The analysis is per-scope: nested subroutines participate in their own
// scope's analysis. A local sub calling an upper-scope sub is treated as a
// leaf edge (upper-scope subs are built before the local scope is even
// known, so they can't back-edge into local subs).

import {callTargetOf} from './commands';
import type {Instructions} from './commands';
import type {CommandFn} from './consts';

export type CallGraphAnalysis = {
  /** Subroutines that participate in cycles (mutual recursion or self-loop). */
  cyclicSet: Set<string>;
  /**
   * Build order — Tarjan's SCC output is in reverse topological order, so
   * the first item is a sink (no outgoing dependencies on later items).
   * Processing in this order ensures each acyclic subroutine's local callees
   * are built before it.
   */
  buildOrder: string[];
};

/**
 * Analyzes a set of local subroutines and returns:
 *   - `cyclicSet`: subroutines that must keep their hopper (in non-trivial
 *     SCC or with self-loop).
 *   - `buildOrder`: order in which to recursively build them so that each
 *     acyclic sub's callees are built first.
 *
 * Edges to subroutines NOT in `localSubroutines` (upper-scope) are leaf
 * edges — they don't affect cycle detection locally.
 */
export function analyzeLocalCallGraph(
  localSubroutines: Record<string, Instructions>,
): CallGraphAnalysis {
  const localNames = new Set(Object.keys(localSubroutines));

  // Adjacency list: local-sub-name → set of LOCAL targets it calls.
  const adj = new Map<string, Set<string>>();

  for (const name of localNames) {
    const allTargets = extractCallTargetsFromInstructions(localSubroutines[name]);
    const localTargets = new Set([...allTargets].filter((t) => localNames.has(t)));

    adj.set(name, localTargets);
  }

  // Tarjan's SCC algorithm. Outputs SCCs in reverse topological order — i.e.,
  // the first SCC in the result is a sink with no outgoing dependencies on
  // later SCCs. Process in this order for correct build order.
  const sccs = tarjanSCC(adj, localNames);

  const cyclicSet = new Set<string>();

  for (const scc of sccs) {
    const isMultiNode = scc.length > 1;

    for (const member of scc) {
      // `adj.get(member)` is always defined — every local name is keyed
      // into `adj` in the loop above. The non-null assertion keeps the
      // branch coverage at 100 without an unreachable `?? false` fallback.
      const hasSelfLoop = adj.get(member)!.has(member);

      if (isMultiNode || hasSelfLoop) {
        cyclicSet.add(member);
      }
    }
  }

  // Build order is Tarjan's reverse-topological output flattened. Within an
  // SCC, the order between members doesn't matter — all members are cyclic
  // and use hoppers, so the build can proceed in any internal order.
  const buildOrder: string[] = sccs.flatMap((scc) => scc);

  return {cyclicSet, buildOrder};
}

function extractCallTargetsFromInstructions(instructions: Instructions): Set<string> {
  const targets = new Set<string>();

  // Malformed inputs (null/undefined/non-object) are caught downstream by
  // PostMachine's instruction validation. The analyzer just returns no edges
  // for them so the caller can proceed to its own throw site.
  if (instructions === null || typeof instructions !== 'object') {
    return targets;
  }

  const visit = (value: unknown): void => {
    if (typeof value === 'function') {
      const target = callTargetOf(value as CommandFn);

      if (target !== undefined) {
        targets.add(target);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
    }
  };

  for (const key of Object.keys(instructions)) {
    if (Number.isFinite(Number(key)) && key.trim() !== '') {
      visit(instructions[key]);
    }
  }

  return targets;
}

/**
 * Tarjan's strongly-connected-components algorithm.
 *
 * Returns SCCs in REVERSE topological order — the first SCC has no outgoing
 * edges to later SCCs, so it can be built first without forward references.
 * Subsequent SCCs may depend on earlier ones.
 *
 * Iterative implementation to avoid recursion-depth issues on deep call
 * chains (we never expect this to fire in practice but it's free defensive
 * coverage).
 */
function tarjanSCC(
  adj: Map<string, Set<string>>,
  nodes: Set<string>,
): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  // Iterative DFS frame: (node, iteratorOverNeighbors).
  type Frame = {node: string; neighbors: Iterator<string>; pendingTarget: string | null};

  const dfs = (start: string): void => {
    const frames: Frame[] = [];

    index.set(start, counter);
    lowlink.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);

    // `adj.get(start)` is always defined — every `nodes` entry is keyed
    // into `adj` by the caller before we start DFS.
    frames.push({
      node: start,
      neighbors: adj.get(start)!.values(),
      pendingTarget: null,
    });

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];

      // If we just returned from a child DFS, fold its lowlink into ours.
      if (frame.pendingTarget !== null) {
        lowlink.set(
          frame.node,
          Math.min(lowlink.get(frame.node)!, lowlink.get(frame.pendingTarget)!),
        );
        frame.pendingTarget = null;
      }

      const {value: next, done} = frame.neighbors.next();

      if (done) {
        // All neighbors visited — emit SCC if this node is a root.
        if (lowlink.get(frame.node) === index.get(frame.node)) {
          const scc: string[] = [];

          while (true) {
            const popped = stack.pop()!;

            onStack.delete(popped);
            scc.push(popped);

            if (popped === frame.node) break;
          }

          sccs.push(scc);
        }

        frames.pop();

        // Tell parent which child we just returned from (for lowlink fold).
        if (frames.length > 0) {
          frames[frames.length - 1].pendingTarget = frame.node;
        }

        continue;
      }

      const target = next as string;

      if (!index.has(target)) {
        // Tree edge — descend.
        index.set(target, counter);
        lowlink.set(target, counter);
        counter += 1;
        stack.push(target);
        onStack.add(target);

        frames.push({
          node: target,
          neighbors: adj.get(target)!.values(),
          pendingTarget: null,
        });
      } else if (onStack.has(target)) {
        // Back edge to an ancestor in the current DFS tree.
        lowlink.set(
          frame.node,
          Math.min(lowlink.get(frame.node)!, index.get(target)!),
        );
      }
      // else: cross edge to a finished SCC — ignore.
    }
  };

  for (const node of nodes) {
    if (!index.has(node)) {
      dfs(node);
    }
  }

  return sccs;
}
