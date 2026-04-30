export function instructionIndexValidator(instructionIndexStr: string | number): boolean {
  const instructionIndex = Number(instructionIndexStr);

  return instructionIndex !== 0 && Number.isInteger(instructionIndex);
}

const subroutineNameRegex = /^[A-Z$_][A-Z0-9$_]*$/i;

export function subroutineNameValidator(subroutineName: string): boolean {
  return subroutineNameRegex.test(subroutineName) && subroutineName !== 'undefined';
}
