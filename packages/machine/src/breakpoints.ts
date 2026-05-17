import type { State } from '@turing-machine-js/machine';
import type { Path } from './path';

export type BreakpointFilter = {
  before?: boolean | string | string[];
  after?: boolean | string | string[];
};

export type BreakpointTarget = Path | string | State;

export type Breakpoint =
  | { kind: 'instruction'; path: Path; filter: BreakpointFilter }
  | { kind: 'halt'; filter: BreakpointFilter };

export function validateBreakpointFilter(filter: BreakpointFilter): void {
  if (filter.before === undefined && filter.after === undefined) {
    throw new Error(
      'Breakpoint filter must set at least one of `before` or `after`.',
    );
  }
}

function mergeOnePhase(
  values: ReadonlyArray<boolean | string | string[] | undefined>,
): boolean | string | string[] | undefined {
  const present = values.filter((v) => v !== undefined) as Array<boolean | string | string[]>;
  if (present.length === 0) return undefined;
  if (present.some((v) => v === true)) return true;
  const symbols = new Set<string>();
  for (const v of present) {
    if (Array.isArray(v)) v.forEach((s) => symbols.add(s));
    else if (typeof v === 'string') symbols.add(v);
  }
  if (symbols.size === 1) return [...symbols][0];
  return [...symbols];
}

export function mergeBreakpointFilters(filters: ReadonlyArray<BreakpointFilter>): BreakpointFilter {
  const before = mergeOnePhase(filters.map((f) => f.before));
  const after = mergeOnePhase(filters.map((f) => f.after));
  const out: BreakpointFilter = {};
  if (before !== undefined) out.before = before;
  if (after !== undefined) out.after = after;
  return out;
}
