import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The determinism rules from CLAUDE.md, checked on the source itself.
const SRC = join(import.meta.dirname, '..', 'src');
/** Only these files may use bitwise operators: their values are uint32 hash/RNG words by design. */
const BITWISE_ALLOWED = new Set(['rng.ts', 'fixed.ts', 'roomCode.ts']);

const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
/** The file as plain JavaScript (types stripped, so `A | B` unions don't look like bitwise or), without comments and string contents. */
const code = (f: string) =>
  ts
    .transpileModule(readFileSync(join(SRC, f), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true } })
    .outputText.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'[^'\n]*'/g, "''");

describe('simulation source rules', () => {
  it.each(files)('%s: no wall clock, no Math.random, no float trig or pow', (f) => {
    const src = code(f);
    for (const banned of [/Date\.now/, /performance\.now/, /new Date/, /Math\.(sin|cos|tan|atan2?|pow|exp|log|hypot)\b/, /\*\*/]) {
      expect(src, `${f} uses ${banned}`).not.toMatch(banned);
    }
    if (f !== 'roomCode.ts') expect(src).not.toMatch(/Math\.random/); // room codes are not part of the simulation
  });

  it.each(files.filter((f) => !BITWISE_ALLOWED.has(f)))('%s: no bitwise operators (they cut fixed-point values to 32 bits)', (f) => {
    expect(code(f)).not.toMatch(/(?<![|&])[|&^](?![|&=])|<<|>>|~/);
  });
});
