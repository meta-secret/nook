/**
 * Decorative ciphertext for the identity UI. It is random base64 text that
 * never contains, derives from, or reveals key material or vault contents.
 */
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const ARMOR_HEADER = "-----BEGIN AGE ENCRYPTED FILE-----";

export type CipherDimensions = {
  readonly rows: number;
  readonly columns: number;
};

export type CipherSegment = {
  readonly text: string;
  readonly hot: boolean;
};

export type CipherLine = readonly CipherSegment[];

function randomBase64(length: number): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += BASE64_ALPHABET[Math.floor(Math.random() * BASE64_ALPHABET.length)];
  }
  return out;
}

function replaceCharacter(line: string): string {
  if (line.length === 0) return line;
  const position = Math.floor(Math.random() * line.length);
  return line.slice(0, position) + randomBase64(1) + line.slice(position + 1);
}

/** Characters a lit run spans. */
const HOT_RUN = 6;

/** A block of age-armored-looking ciphertext that re-encrypts a few characters per tick. */
export class CipherBlock {
  private lines: string[];
  private hotLine = -1;
  private hotStart = 0;

  constructor(private readonly dimensions: CipherDimensions) {
    this.lines = [ARMOR_HEADER];
    for (let row = 1; row < dimensions.rows; row += 1) {
      this.lines.push(randomBase64(dimensions.columns));
    }
  }

  /** Re-encrypt `changes` characters and pick a short run to flash. */
  tick(changes: number): void {
    const bodyRows = this.lines.length - 1;
    if (bodyRows <= 0) return;
    this.reencrypt(changes);
    this.hotLine = 1 + Math.floor(Math.random() * bodyRows);
    this.hotStart = Math.floor(Math.random() * this.dimensions.columns);
  }

  /** Re-encrypt `changes` characters and move the lit run one column along
   * its row, starting on another row once it reaches the end: a slow crawl
   * instead of a flash in a new place every tick. */
  crawl(changes: number): void {
    const bodyRows = this.lines.length - 1;
    if (bodyRows <= 0) return;
    this.reencrypt(changes);
    if (
      this.hotLine < 1 ||
      this.hotStart + HOT_RUN >= this.dimensions.columns
    ) {
      this.hotLine = 1 + Math.floor(Math.random() * bodyRows);
      this.hotStart = 0;
      return;
    }
    this.hotStart += 1;
  }

  private reencrypt(changes: number): void {
    const bodyRows = this.lines.length - 1;
    for (let change = 0; change < changes; change += 1) {
      const row = 1 + Math.floor(Math.random() * bodyRows);
      const line = this.lines[row];
      if (line) this.lines[row] = replaceCharacter(line);
    }
  }

  get segments(): readonly CipherLine[] {
    const result: CipherLine[] = [];
    for (const [row, line] of this.lines.entries()) {
      result.push(
        row === this.hotLine ? this.hotSegments(line) : [plain(line)],
      );
    }
    return result;
  }

  private hotSegments(line: string): CipherLine {
    const end = this.hotStart + HOT_RUN;
    const hot: CipherSegment = {
      text: line.slice(this.hotStart, end),
      hot: true,
    };
    return [plain(line.slice(0, this.hotStart)), hot, plain(line.slice(end))];
  }
}

function plain(text: string): CipherSegment {
  return { text, hot: false };
}

/** A single line of ciphertext that drifts while something stays encrypted. */
export class CipherStripText {
  private value: string;

  constructor(length: number) {
    this.value = randomBase64(length);
  }

  tick(changes: number): void {
    for (let change = 0; change < changes; change += 1) {
      this.value = replaceCharacter(this.value);
    }
  }

  get text(): string {
    return this.value;
  }
}

/** Motion is decoration: skip it for reduced-motion users and hidden tabs. */
export function cipherMotionAllowed(): boolean {
  if (!("window" in globalThis)) return false;
  if (document.hidden) return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
