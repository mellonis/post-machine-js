import {
  PostMachine, Tape, alphabet, blankSymbol, call, check, erase, left, mark, markSymbol, right, stop,
  summarizePostMachine,
} from '../index';
import { getRandomInstructionIndex } from './PostMachine.test-helpers';

describe('PostMachine custom alphabet', () => {
  describe('default behavior (no options)', () => {
    test('uses the module-level blank/mark symbols', () => {
      const machine = new PostMachine({ 1: stop });

      expect(machine.tape.alphabet.blankSymbol).toBe(blankSymbol);
      expect(machine.tape.alphabet.symbols).toEqual(alphabet.symbols);
      expect(machine.tape.alphabet.symbols).toEqual([' ', '*']);
      expect(machine.tape.alphabet.has(markSymbol)).toBe(true);
    });
  });

  describe('options validation', () => {
    test.each<[string, unknown, unknown]>([
      ['blankSymbol must be a single character', '..', '#'],
      ['blankSymbol must be a single character', '', '#'],
      ['blankSymbol must be a single character', 0, '#'],
      ['markSymbol must be a single character', '.', '##'],
      ['markSymbol must be a single character', '.', ''],
      ['markSymbol must be a single character', '.', 0],
      ['blankSymbol and markSymbol must be distinct', '.', '.'],
    ])('throws "%s"', (message, blank, mark) => {
      expect(() => new PostMachine(
        { 1: stop },
        { blankSymbol: blank as string, markSymbol: mark as string },
      )).toThrow(message);
    });

    test('null/undefined fall back to defaults (not validation errors)', () => {
      // ?? operator treats null and undefined as "use default"; only an
      // explicit non-string-or-wrong-length value should fail validation.
      const m1 = new PostMachine({ 1: stop }, { blankSymbol: undefined, markSymbol: undefined });
      expect(m1.tape.alphabet.symbols).toEqual([' ', '*']);

      const m2 = new PostMachine({ 1: stop }, { blankSymbol: null as unknown as string });
      expect(m2.tape.alphabet.symbols).toEqual([' ', '*']);
    });
  });

  describe('partial overrides', () => {
    test('only blankSymbol overridden — markSymbol falls back to default', () => {
      const machine = new PostMachine({ 1: stop }, { blankSymbol: '.' });

      expect(machine.tape.alphabet.symbols).toEqual(['.', '*']);
    });

    test('only markSymbol overridden — blankSymbol falls back to default', () => {
      const machine = new PostMachine({ 1: stop }, { markSymbol: '#' });

      expect(machine.tape.alphabet.symbols).toEqual([' ', '#']);
    });

    test('partial override that collides with the default of the other symbol throws', () => {
      // mark default is '*'; setting blank to '*' collides.
      expect(() => new PostMachine({ 1: stop }, { blankSymbol: '*' }))
        .toThrow('blankSymbol and markSymbol must be distinct');
    });
  });

  describe('full override', () => {
    test('builds a per-instance alphabet with the chosen symbols', () => {
      const machine = new PostMachine({ 1: stop }, { blankSymbol: '.', markSymbol: '#' });

      expect(machine.tape.alphabet.symbols).toEqual(['.', '#']);
      expect(machine.tape.alphabet.blankSymbol).toBe('.');
    });

    test('mark writes the chosen mark symbol', async () => {
      const machine = new PostMachine(
        { 1: mark, 2: stop },
        { blankSymbol: '.', markSymbol: '#' },
      );

      machine.replaceTapeWith(new Tape({
        alphabet: machine.tape.alphabet,
        symbols: ['.'],
      }));

      machine.run();

      expect(machine.tape.symbols.join('')).toBe('#');
    });

    test('erase writes the chosen blank symbol', async () => {
      const machine = new PostMachine(
        { 1: erase, 2: stop },
        { blankSymbol: '.', markSymbol: '#' },
      );

      machine.replaceTapeWith(new Tape({
        alphabet: machine.tape.alphabet,
        symbols: ['#'],
      }));

      machine.run();

      expect(machine.tape.symbols.join('')).toBe('.');
    });

    test('check branches on the chosen mark/blank symbols', async () => {
      // Same program as the README quick start, but with .#  alphabet:
      // walk right while marked, write a mark on the first blank.
      const machine = new PostMachine(
        {
          10: check(20, 30),
          20: right(10),
          30: mark,
          40: stop,
        },
        { blankSymbol: '.', markSymbol: '#' },
      );

      machine.replaceTapeWith(new Tape({
        alphabet: machine.tape.alphabet,
        symbols: ['#', '#', '.'],
      }));

      machine.run();

      expect(machine.tape.symbols.join('').replace(/\.+$/, '')).toBe('###');
    });

    test('left/right/noop work with custom alphabet (no symbol writes)', async () => {
      const ix = getRandomInstructionIndex();
      const next = ix + 1;

      const machine = new PostMachine(
        { [ix]: right(next), [next]: stop },
        { blankSymbol: '.', markSymbol: '#' },
      );

      machine.replaceTapeWith(new Tape({
        alphabet: machine.tape.alphabet,
        symbols: ['#', '.', '#'],
        position: 0,
      }));

      machine.run();

      // head moved right by one; tape contents unchanged
      expect(machine.tape.symbols.join('')).toBe('#.#');
    });

    test('subroutines inherit the custom alphabet', async () => {
      const machine = new PostMachine(
        {
          rightToBlank: {
            1: right,
            2: check(1, 3),
            3: stop,
          },
          1: call('rightToBlank'),
          2: mark,
          3: stop,
        },
        { blankSymbol: '.', markSymbol: '#' },
      );

      machine.replaceTapeWith(new Tape({
        alphabet: machine.tape.alphabet,
        symbols: ['#', '#', '.'],
      }));

      machine.run();

      expect(machine.tape.symbols.join('').replace(/\.+$/, '')).toBe('###');
    });

    test('groups inherit the custom alphabet', async () => {
      // group: write mark, then move right.
      const machine = new PostMachine(
        {
          1: [mark, right],
          2: stop,
        },
        { blankSymbol: '.', markSymbol: '#' },
      );

      machine.replaceTapeWith(new Tape({
        alphabet: machine.tape.alphabet,
        symbols: ['.', '.'],
      }));

      machine.run();

      expect(machine.tape.symbols.join('')).toBe('#.');
    });

    test('summarizePostMachine still reports tapeCount: 1, alphabetCardinalities: [2]', () => {
      const machine = new PostMachine(
        {
          10: check(20, 30),
          20: right(10),
          30: mark,
          40: stop,
        },
        { blankSymbol: '.', markSymbol: '#' },
      );

      const summary = summarizePostMachine(machine);

      expect(summary.tapeCount).toBe(1);
      expect(summary.alphabetCardinalities).toEqual([2]);
    });

    test('non-ASCII glyphs work (Unicode open box / heavy dot)', async () => {
      const machine = new PostMachine(
        {
          10: check(20, 30),
          20: right(10),
          30: mark,
          40: stop,
        },
        { blankSymbol: '␣', markSymbol: '•' },
      );

      machine.replaceTapeWith(new Tape({
        alphabet: machine.tape.alphabet,
        symbols: ['•', '•', '␣'],
      }));

      machine.run();

      expect(machine.tape.symbols.join('').replace(/␣+$/, '')).toBe('•••');
    });
  });

  describe('left/right/noop unaffected by custom alphabet', () => {
    test('left moves head one cell to the left regardless of symbols', async () => {
      const machine = new PostMachine(
        { 1: left(2), 2: stop },
        { blankSymbol: '.', markSymbol: '#' },
      );

      machine.replaceTapeWith(new Tape({
        alphabet: machine.tape.alphabet,
        symbols: ['#', '#'],
        position: 1,
      }));

      machine.run();

      // After one left move, head sits at position 0; symbols unchanged.
      expect(machine.tape.symbols.join('')).toBe('##');
    });
  });
});
