// Port of keiyoushi/extensions-source src/en/mangalix/JsLiteralParser.kt
// A data-only parser for JS object/array literals (never executes anything). Values are plain JSON values.
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const isDigit = (c: string) => c >= "0" && c <= "9";
const isLetterOrDigit = (c: string) => /[\p{L}\p{Nd}]/u.test(c);
const isWhitespace = (c: string) => /\s/.test(c);

export class JsLiteralParser {
  private position: number;

  constructor(
    private readonly source: string,
    startIndex: number,
  ) {
    this.position = startIndex;
  }

  parse(): Json {
    this.skipWhitespace();
    return this.parseValue();
  }

  private parseValue(): Json {
    this.skipWhitespace();
    const c = this.peek();
    if (c === "{") return this.parseObject();
    if (c === "[") return this.parseArray();
    if (c === "'" || c === '"') return this.parseString();
    if (c === "-" || c === "+" || isDigit(c)) return this.parseNumber();
    return this.parseKeyword();
  }

  private parseObject(): Json {
    this.expect("{");
    this.skipWhitespace();

    const values: { [k: string]: Json } = {};
    if (this.consume("}")) return values;

    for (;;) {
      this.skipWhitespace();
      const c = this.peek();
      const key = c === "'" || c === '"' ? this.parseString() : this.parseIdentifier();

      this.skipWhitespace();
      this.expect(":");
      values[key] = this.parseValue();

      this.skipWhitespace();
      if (this.consume("}")) break;
      this.expect(",");
      this.skipWhitespace();
      if (this.consume("}")) break;
    }

    return values;
  }

  private parseArray(): Json {
    this.expect("[");
    this.skipWhitespace();

    const values: Json[] = [];
    if (this.consume("]")) return values;

    for (;;) {
      values.push(this.parseValue());

      this.skipWhitespace();
      if (this.consume("]")) break;
      this.expect(",");
      this.skipWhitespace();
      if (this.consume("]")) break;
    }

    return values;
  }

  private parseString(): string {
    const quote = this.next();
    let result = "";

    while (this.position < this.source.length) {
      const char = this.next();
      if (char === quote) return result;
      if (char !== "\\") {
        result += char;
        continue;
      }

      if (this.position >= this.source.length) this.fail("Unterminated escape sequence");
      const escaped = this.next();
      switch (escaped) {
        case "'":
        case '"':
        case "\\":
        case "/":
          result += escaped;
          break;
        case "b":
          result += "\b";
          break;
        case "f":
          result += "\u000C";
          break;
        case "n":
          result += "\n";
          break;
        case "r":
          result += "\r";
          break;
        case "t":
          result += "\t";
          break;
        case "v":
          result += "\u000B";
          break;
        case "0":
          result += "\u0000";
          break;
        case "x":
          result += String.fromCharCode(this.readHex(2));
          break;
        case "u":
          if (this.consume("{")) {
            const end = this.source.indexOf("}", this.position);
            if (end === -1) this.fail("Unterminated Unicode escape");
            const text = this.source.substring(this.position, end);
            const codePoint = /^[+-]?[0-9a-fA-F]+$/.test(text) ? Number.parseInt(text, 16) : Number.NaN;
            if (Number.isNaN(codePoint) || codePoint < 0 || codePoint > 0x10ffff) this.fail("Invalid Unicode escape");
            result += String.fromCodePoint(codePoint);
            this.position = end + 1;
          } else result += String.fromCharCode(this.readHex(4));
          break;
        case "\n":
          break;
        case "\r":
          this.consume("\n");
          break;
        default:
          result += escaped;
      }
    }

    return this.fail("Unterminated string");
  }

  private parseNumber(): number {
    const start = this.position;
    const s = this.source;
    if (this.peek() === "+" || this.peek() === "-") this.position++;
    while (this.position < s.length && isDigit(s[this.position])) this.position++;
    if (this.position < s.length && s[this.position] === ".") {
      this.position++;
      while (this.position < s.length && isDigit(s[this.position])) this.position++;
    }
    if (this.position < s.length && "eE".includes(s[this.position])) {
      this.position++;
      if (this.position < s.length && "+-".includes(s[this.position])) this.position++;
      while (this.position < s.length && isDigit(s[this.position])) this.position++;
    }

    const number = s.substring(start, this.position);
    const value = Number(number);
    if (number === "" || number === "+" || number === "-" || Number.isNaN(value)) this.fail("Invalid number");
    return value;
  }

  private parseKeyword(): Json {
    const value = this.parseIdentifier();
    switch (value) {
      case "true":
        return true;
      case "false":
        return false;
      case "null":
      case "undefined":
        return null;
      default:
        return this.fail(`Unsupported value '${value}'`);
    }
  }

  private parseIdentifier(): string {
    const start = this.position;
    while (this.position < this.source.length) {
      const char = this.source[this.position];
      if (!isLetterOrDigit(char) && char !== "_" && char !== "$") break;
      this.position++;
    }
    if (this.position === start) this.fail("Expected identifier");
    return this.source.substring(start, this.position);
  }

  private readHex(length: number): number {
    if (this.position + length > this.source.length) this.fail("Incomplete hexadecimal escape");
    const text = this.source.substring(this.position, this.position + length);
    if (!/^[0-9a-fA-F]+$/.test(text)) this.fail("Invalid hexadecimal escape");
    this.position += length;
    return Number.parseInt(text, 16);
  }

  private skipWhitespace() {
    while (this.position < this.source.length && isWhitespace(this.source[this.position])) this.position++;
  }

  private peek(): string {
    const c = this.source[this.position];
    if (c === undefined) this.fail("Unexpected end of input");
    return c;
  }

  private next(): string {
    const c = this.peek();
    this.position++;
    return c;
  }

  private expect(expected: string) {
    if (!this.consume(expected)) this.fail(`Expected '${expected}'`);
  }

  private consume(expected: string): boolean {
    if (this.source[this.position] !== expected) return false;
    this.position++;
    return true;
  }

  private fail(message: string): never {
    throw new Error(`${message} at position ${this.position}`);
  }
}
