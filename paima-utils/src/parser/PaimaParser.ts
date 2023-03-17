import type { IToken, Parser } from 'ebnf';
import { Grammars } from 'ebnf';
import { BLOCK_TIME } from '../config';

//
// This Parser converts PaimaLang:
// ----------------------------------------
// const paimaLang = `
// createLobby         = c|numOfRounds|roundLength|isHidden?|isPractice?
// joinedLobby         = j|*lobbyID
// closeLobby          = cs|*lobbyID
// moves               = s|*lobbyID|roundNumber|move_rps
// zombieScheduledData = z|*lobbyID
// userScheduledData   = u|*user|result
// sample              = x|sampleParam
// `
// ----------------------------------------
// into parseable eBNF W3C grammar
//
// syntax ::= createLobby | otherCommand
// createLobby ::= "c" pipe asterisk lobby pipe numOfRounds pipe roundLength pipe isHidden? pipe isPractice?
// otherCommand ::= "x" pipe asterisk lobby pipe numOfRounds pipe roundLength pipe isHidden? pipe isPractice?
// asterisk  ::= "*"
// pipe ::= "|"
// lobby ::= [a-zA-Z0-9]*
// numOfRounds ::= [a-zA-Z0-9]*
// roundLength ::= [a-zA-Z0-9]*
// isHidden ::= [a-zA-Z0-9]*
// isPractice ::= [a-zA-Z0-9]*
//
// and mixes this with the commands:
// -------------------------------------------------
// {
//    [key: commandName] : {
//                [key: parameterName] : function | string | number | boolean | null
//    }
// }
// -------------------------------------------------
//
// Where commandName is createLobby | joinedLobby | closeLobby | etc
// and parameterName is numOfRounds | roundLength | isHidden
//
// A special parameterName "renameCommand" is used for RENAMING the command in the output.
// Because PaimaLang doesn't allow duplicated commandNames
//
// There are some reserved parameterName: asterisk | pipe | syntax
//
// PaimaParser includes Parsers for common types, e.g., Numbers, Booleans, WalletAddress, etc.
// Or accepts inlined custom functions with the signature (key: string, value: string) => string
//
// For example a "command" definition for the previous PaimaLang:
//
// const command = {
//   createLobby: {
//     numOfRounds: PaimaParser.NumberParser(3, 1000),
//     roundLength: PaimaParser.RoundLength(),
//     isHidden: PaimaParser.TrueFalseParser(false),
//     isPractice: PaimaParser.TrueFalseParser(false),
//   },
//   joinedLobby: {
//     lobbyID: PaimaParser.NCharsParser(12, 12),
//   },
//   closeLobby: {
//     lobbyID: PaimaParser.NCharsParser(12, 12),
//   },
//   moves: {
//     lobbyID: PaimaParser.NCharsParser(12, 12),
//     roundNumber: PaimaParser.NumberParser(1, 1000),
//     move_rps: PaimaParser.RegexParser(/^[RPS]$/),
//   },
//   zombieScheduledData: {
//     renameCommand: 'scheduledData',
//     lobbyID: PaimaParser.NCharsParser(12, 12),
//   },
//   userScheduledData: {
//     renameCommand: 'scheduledData',
//     user: PaimaParser.WalletAddress(),
//     result: PaimaParser.RegexParser(/^[w|t|l]$/),
//   },
//   sample: {
//     sampleParam: (key: string, input: string) => {
//        if (!input) throw new Error(`${key} input must be defined`);
//        return input.split('').reverse().join(''); // reverse strings
//     }
//   },
// };
//
// To create the parser create a instance of the parser
// And parse the inputs with p.start(input)
// -------------------------------------------------
// const p = new PaimaParser(paimaLang, command);
// try {
//    const output = p.start('x|helloWorld');
//  } catch (e) {
//    // could not parse the input.
//  }
// -------------------------------------------------
//  will output: { command: sample, args : { sampleParam: 'helloWorld' } }
//
type ParserValues = string | boolean | number | null;
type ParserCommandExec = (keyName: string, input: string) => ParserValues;

export type ParserCommands = Record<string, Record<string, ParserValues | ParserCommandExec>>;

export class PaimaParser {
  private readonly grammar: string;
  private readonly commands: ParserCommands;
  private readonly parser: Parser;

  private readonly debug = process.env.NODE_ENV === 'development';

  constructor(paimaLang: string, commands: ParserCommands) {
    this.grammar = this.paimaLangToBNF(paimaLang);
    this.parser = new Grammars.W3C.Parser(this.grammar);
    this.commands = commands;
  }

  // Convert PaimaLang definition to eBNF (W3C)
  private paimaLangToBNF(paimaLang: string): string {
    const commandParameters: Record<string, string[]> = {};
    const commandLiterals: Record<string, string> = {};

    /*
     * Extract commands, parameters and literals
     * a = b|c|d , e = f|g into { a: [c,d], e: [g] } and { a: b, e: f }
     */
    let grammar = paimaLang
      .split('\n')
      .map(x => x.trim())
      .filter(x => x)
      .map(x => {
        // myCommandName = s|custom|named|parameters
        const parts = x.split('=').map(x => x.trim());
        if (parts.length !== 2) throw new Error('Incorrect parser format');
        const c = parts[1].split('|');
        const literal = c.shift();
        if (!literal) throw new Error('Missing literal');
        commandLiterals[parts[0]] = literal;
        commandParameters[parts[0]] = c;
      })
      .join('');

    // keep track of unique parameters.
    const uniqueParameters: Set<string> = new Set();
    grammar = `syntax ::= ${Object.keys(commandParameters).join(' | ')}\n`;
    Object.keys(commandParameters).forEach(key => {
      grammar += `${key} ::= "${commandLiterals[key]}" pipe ${commandParameters[key]
        .map(parameter => {
          // Check for asterisks and optional question marks
          if (parameter.match(/\*/)) {
            const partNoAsterisk = parameter.replace(/\*/, '');
            uniqueParameters.add(partNoAsterisk);
            return `asterisk ${partNoAsterisk}`;
          }
          if (parameter.match(/\?$/)) {
            const partNoOptional = parameter.replace(/\?$/, '');
            uniqueParameters.add(partNoOptional);
            return `${partNoOptional}?`;
          }

          uniqueParameters.add(parameter);
          return parameter;
        })
        .join(' pipe ')}\n`;
    });

    // Add standard - common expressions to parse * and |
    grammar += 'asterisk  ::= "*"\npipe ::= "|" \n';

    // Add parameters back-into grammar
    [...uniqueParameters].forEach(w => {
      grammar += `${w} ::= [a-zA-Z0-9]* \n`;
    });

    this.log(`Parser Syntax: \n----------------\n${grammar}\n----------------`);
    return grammar;
  }

  public static TrueFalseParser(defaultValue?: boolean): ParserCommandExec {
    return (keyName: string, input: string): boolean => {
      const hasDefault = typeof defaultValue === 'boolean';
      if (input == null && hasDefault) return defaultValue;
      if (input == null && !hasDefault) throw new Error(`${keyName} must be T or F`);
      if (input === 'T' || input === 'F') return input === 'T';
      throw new Error(`${keyName} must be T or F`);
    };
  }

  public static RoundLength(): ParserCommandExec {
    return (keyName: string, input: string): number => {
      if (input == null) throw new Error(`${keyName} must be defined`);
      const n = parseInt(input, 10);
      const BLOCKS_PER_MINUTE = 60 / BLOCK_TIME;
      const BLOCKS_PER_DAY = BLOCKS_PER_MINUTE * 60 * 24;
      if (n < BLOCKS_PER_MINUTE) throw new Error(`${keyName} is less then ${BLOCKS_PER_MINUTE}`);
      if (n > BLOCKS_PER_DAY) throw new Error(`${keyName} is greater then ${BLOCKS_PER_DAY}`);
      return n;
    };
  }

  public static NumberParser(min: number, max: number): ParserCommandExec {
    return (keyName: string, input: string): number => {
      if (input == null) throw new Error(`${keyName} must be defined`);
      const n = parseInt(input, 10);
      if (isNaN(n)) throw new Error(`${keyName} not a number`);
      if (n < min) throw new Error(`${keyName} must be greater than ${min}`);
      if (n > max) throw new Error(`${keyName} must be less than ${max}`);
      return n;
    };
  }

  public static NCharsParser(minChars: number, maxChars: number): ParserCommandExec {
    return (keyName: string, input: string): string => {
      if (input == null) throw new Error(`${keyName} must be defined`);
      if (input.length < minChars)
        throw new Error(`${keyName} must have more chars than ${minChars}`);
      if (input.length > maxChars)
        throw new Error(`${keyName} must have less chars than ${maxChars}`);
      return input;
    };
  }

  public static RegexParser(regex: RegExp): ParserCommandExec {
    return (keyName: string, input: string): string => {
      if (input == null) throw new Error(`${keyName} must be defined`);
      if (!input.match(regex)) throw new Error(`${keyName}: must match ${String(regex)}`);
      return input;
    };
  }

  public static HexParser(): ParserCommandExec {
    return PaimaParser.RegexParser(/0x([0-9a-f]+)/);
  }

  public static WalletAddress(): ParserCommandExec {
    return PaimaParser.RegexParser(/^[a-zA-Z0-9]+$/);
  }

  private log(message: string): void {
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log('[Paima-Parser]', message);
    }
  }

  start(sentence: string): { command: string; args: Record<string, ParserValues> } {
    const parseTree: IToken = this.parser.getAST(sentence);

    if (!parseTree) {
      this.log(`Error parsing ${sentence}`);
      throw new Error('Cannot parse: ' + sentence);
    }

    const getFromTree = (type: string, ast: IToken): string =>
      ast?.children?.find(c => c.type === type)?.text as string;

    const interpreter: Record<string, ParserValues | ParserCommandExec> =
      this.commands[parseTree.children[0].type];
    const results: Record<string, ParserValues> = {};
    Object.keys(interpreter).forEach((key: string) => {
      const parserCommand: ParserValues | ParserCommandExec = interpreter[key];
      if (parserCommand && typeof parserCommand === 'function') {
        results[key] = parserCommand(key, getFromTree(key, parseTree.children[0]));
      } else if (key !== 'renameCommand') {
        // Copy static keys into final object as 'type: zombie'
        results[key] = parserCommand;
      }
    });

    return {
      command: (interpreter.renameCommand as string) || parseTree.children[0].type,
      args: results,
    };
  }
}
