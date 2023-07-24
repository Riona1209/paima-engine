import { describe, expect, test } from '@jest/globals';
import { PaimaParser } from '../src/PaimaParser';

const myGrammar = `
  join = j|
`;

const parserCommands = {
  join: {},
};

describe('Test single commands', () => {
  const startTest = (inputs: [string, boolean][]): void => {
    const parser = new PaimaParser(myGrammar, parserCommands);
    inputs.forEach((i: [string, boolean]) => {
      test(`${i[0]} to be ${i[1]}`, () => {
        try {
          const value = !!parser.start(i[0]);
          expect(value).toBe(i[1]);
        } catch (e) {
          expect(false).toBe(i[1]);
        }
      });
    });
  };

  startTest([
    ['j|T', false],
    ['j|', true],
    ['j', false],
  ]);
});