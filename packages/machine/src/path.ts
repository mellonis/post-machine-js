export type Path = {
  scope?: string | string[];
  instructionIndex: number;
  groupInstructionIndex?: number;
};

// Subroutine name regex matches PostMachine's existing subroutineNameValidator.
const SUBROUTINE_NAME_REGEX = /^[A-Z$_][A-Z0-9$_]*$/i;

export function normalizeScope(scope: string | string[] | undefined): string[] {
  if (!scope) return [];
  return typeof scope === 'string' ? scope.split('::') : [...scope];
}

export function parsePath(s: string): Path {
  if (!s) {
    throw new Error(`invalid path: empty string`);
  }

  if (s.includes('(') || s.includes(')')) {
    throw new Error(`invalid path '${s}': contains '(' or ')', which marks the engine's wrapper composite (not an instruction path)`);
  }

  if (s.includes('~')) {
    throw new Error(`invalid path '${s}': contains '~', which marks continuation states (not an instruction path)`);
  }

  if (s === 'halt') {
    throw new Error(`invalid path 'halt': haltState is not an instruction path`);
  }

  if (s.startsWith('::')) {
    throw new Error(`invalid path '${s}': leading '::' is not allowed; top-level paths have no scope prefix`);
  }

  // Split scope from the final segment. The final segment is either '<idx>' or '<idx>.<group>'.
  const segments = s.split('::');
  for (const seg of segments) {
    if (seg === '') {
      throw new Error(`invalid path '${s}': empty scope segment`);
    }
  }

  const finalSegment = segments.pop() as string;
  const scopeSegments = segments;

  for (const seg of scopeSegments) {
    if (!SUBROUTINE_NAME_REGEX.test(seg)) {
      throw new Error(`invalid path '${s}': scope segment '${seg}' is not a valid subroutine name (must be an identifier)`);
    }
  }

  // Final segment: parse '<idx>' or '<idx>.<group>'.
  let instructionIndexStr: string;
  let groupInstructionIndex: number | undefined;

  if (finalSegment.includes('.')) {
    const parts = finalSegment.split('.');
    if (parts.length > 2) {
      throw new Error(`invalid path '${s}': multiple '.' in final segment`);
    }
    const [idxStr, groupStr] = parts;
    instructionIndexStr = idxStr;
    const groupNum = Number(groupStr);
    if (!Number.isInteger(groupNum) || groupNum < 1) {
      throw new Error(`invalid path '${s}': group inner index must be a positive integer, got '${groupStr}'`);
    }
    groupInstructionIndex = groupNum;
  } else {
    instructionIndexStr = finalSegment;
  }

  const instructionIndex = Number(instructionIndexStr);
  if (!Number.isInteger(instructionIndex) || instructionIndex < 1) {
    throw new Error(`invalid path '${s}': instruction index must be a positive integer, got '${instructionIndexStr}'`);
  }

  const path: Path = { instructionIndex };
  if (scopeSegments.length > 0) {
    path.scope = scopeSegments;
  }
  if (groupInstructionIndex !== undefined) {
    path.groupInstructionIndex = groupInstructionIndex;
  }
  return path;
}

export function formatPath(p: Path): string {
  const scope = normalizeScope(p.scope);
  const scopeStr = scope.length > 0 ? `${scope.join('::')}::` : '';
  const groupSuffix = p.groupInstructionIndex !== undefined ? `.${p.groupInstructionIndex}` : '';
  return `${scopeStr}${p.instructionIndex}${groupSuffix}`;
}

export function comparePathsCanonically(a: Path, b: Path): number {
  const aScope = normalizeScope(a.scope).join('::');
  const bScope = normalizeScope(b.scope).join('::');
  if (aScope !== bScope) return aScope < bScope ? -1 : 1;
  if (a.instructionIndex !== b.instructionIndex) return a.instructionIndex - b.instructionIndex;
  const aGroup = a.groupInstructionIndex ?? -1;
  const bGroup = b.groupInstructionIndex ?? -1;
  return aGroup - bGroup;
}
