import { Alphabet, TapeBlock } from '@turing-machine-js/machine';

export const blankSymbol = ' ';
export const defaultNextInstructionIndex = Symbol('defaultNextInstructionIndex');
export const markSymbol = '*';
export const alphabet = new Alphabet({
  symbolList: [blankSymbol, markSymbol],
});
export const originalTapeBlock = new TapeBlock({
  alphabetList: [alphabet],
});
