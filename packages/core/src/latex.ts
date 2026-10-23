// LaTeX math handed to mitex. Two jobs mitex does not do for us:
//
// 1. mitex spaces a bare `|` (and `\|`) as a relation, so |x| renders as
//    "| x |". Paired bars are rewritten to \lvert…\rvert (\lVert…\rVert),
//    which mitex renders as delimiters.
// 2. mitex accepts malformed input silently, so structural errors (unbalanced
//    braces, \left without \right, mismatched environments) are linted here.

import type { DiagnosticCopy } from "./diagnostics.js";

export interface MathProblem {
  /** Offset within the LaTeX source. */
  readonly offset: number;
  readonly message: string;
  readonly copy?: DiagnosticCopy;
}

const SIZED_DELIMITER = /\\(?:left|right|middle|big|Big|bigg|Bigg)[lrm]?$/;

/** Rewrites paired `|` and `\|` bars into explicit left/right delimiters. */
export function normalizeBars(latex: string): string {
  const single: number[] = [];
  const double: number[] = [];
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === "\\") {
      if (latex[i + 1] === "|" && !SIZED_DELIMITER.test(latex.slice(0, i))) double.push(i);
      i++;
      continue;
    }
    if (ch === "|" && !SIZED_DELIMITER.test(latex.slice(0, i))) single.push(i);
  }
  // Only rewrite when bars pair up; an odd count (e.g. a conditional bar in
  // set-builder notation) is left for mitex as written.
  const replacements = new Map<number, [number, string]>();
  if (single.length % 2 === 0) {
    single.forEach((at, n) => replacements.set(at, [1, n % 2 === 0 ? "\\lvert " : "\\rvert "]));
  }
  if (double.length % 2 === 0) {
    double.forEach((at, n) => replacements.set(at, [2, n % 2 === 0 ? "\\lVert " : "\\rVert "]));
  }
  if (!replacements.size) return latex;
  let out = "";
  for (let i = 0; i < latex.length; i++) {
    const r = replacements.get(i);
    if (r) {
      out += r[1];
      i += r[0] - 1;
    } else out += latex[i];
  }
  return out;
}

/** Structural problems mitex would render silently. */
export function lintMath(latex: string): MathProblem[] {
  const problems: MathProblem[] = [];
  const braces: number[] = [];
  const envs: { name: string; offset: number }[] = [];
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === "\\") {
      const cmd = /^\\([A-Za-z]+|.)/.exec(latex.slice(i));
      const name = cmd?.[1] ?? "";
      if (name === "begin" || name === "end") {
        const env = /^\{([^}]*)\}/.exec(latex.slice(i + name.length + 1));
        if (env) {
          if (name === "begin") envs.push({ name: env[1] ?? "", offset: i });
          else {
            const open = envs.pop();
            if (!open) problems.push({ offset: i, message: `\\end{${env[1]}} has no matching \\begin.`, copy: { code: "math-end-unmatched", values: [env[1] ?? ""] } });
            else if (open.name !== env[1]) {
              problems.push({ offset: i, message: `\\end{${env[1]}} closes \\begin{${open.name}}.`, copy: { code: "math-env-mismatch", values: [env[1] ?? "", open.name] } });
            }
          }
        }
      }
      i += Math.max(0, (cmd?.[0].length ?? 1) - 1);
      continue;
    }
    if (ch === "{") braces.push(i);
    else if (ch === "}") {
      if (braces.pop() === undefined) problems.push({ offset: i, message: "Unmatched closing brace.", copy: { code: "math-brace-unmatched" } });
    }
  }
  for (const at of braces) problems.push({ offset: at, message: "Unclosed brace.", copy: { code: "math-brace-unclosed" } });
  for (const env of envs) problems.push({ offset: env.offset, message: `\\begin{${env.name}} is never closed.`, copy: { code: "math-env-unclosed", values: [env.name] } });
  const leftCount = (latex.match(/\\left(?![A-Za-z])/g) ?? []).length;
  const rightCount = (latex.match(/\\right(?![A-Za-z])/g) ?? []).length;
  if (leftCount !== rightCount) {
    problems.push({ offset: Math.max(0, latex.search(/\\(left|right)(?![A-Za-z])/)), message: `${leftCount} \\left but ${rightCount} \\right.`, copy: { code: "math-delimiters", values: [leftCount, rightCount] } });
  }
  return problems.sort((a, b) => a.offset - b.offset);
}
