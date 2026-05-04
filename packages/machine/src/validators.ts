export function instructionIndexValidator(instructionIndexStr: string | number): boolean {
  const instructionIndex = Number(instructionIndexStr);

  return instructionIndex !== 0 && Number.isInteger(instructionIndex);
}

const subroutineNameRegex = /^[A-Z$_][A-Z0-9$_]*$/i;

export function subroutineNameValidator(subroutineName: string): boolean {
  return subroutineNameRegex.test(subroutineName) && subroutineName !== 'undefined';
}

export function validateSymbolPair(blankSymbol: unknown, markSymbol: unknown): void {
  if (typeof blankSymbol !== 'string' || blankSymbol.length !== 1) {
    throw new Error('blankSymbol must be a single character');
  }
  if (typeof markSymbol !== 'string' || markSymbol.length !== 1) {
    throw new Error('markSymbol must be a single character');
  }
  if (blankSymbol === markSymbol) {
    throw new Error('blankSymbol and markSymbol must be distinct');
  }
}
