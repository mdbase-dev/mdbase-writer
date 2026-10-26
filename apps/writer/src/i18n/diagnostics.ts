import { t } from "@lingui/core/macro";
import type { DiagnosticCopy } from "@mdbase-writer/core";

/** Only Writer-owned UI guidance is localized. Raw Typst/authority diagnostics,
 * record identifiers, syntax tokens and exported manuscript content stay intact. */
export function diagnosticMessage(message: string, copy?: DiagnosticCopy): string {
  if (!copy) return message;
  const [value = "", other = ""] = copy.values ?? [];
  switch (copy.code) {
    case "embed-missing": return t`No record matches the embed ![[${value}]].`;
    case "embed-cycle": return t`Embedding ${value} here would include it inside itself.`;
    case "label-duplicate": return t`The label ${value} is used more than once.`;
    case "label-missing": return t`Nothing is labelled ${value}.`;
    case "citekey-missing": return t`No source in the library has the citekey ${value}.`;
    case "citation-mixed": return t`A citation cannot mix cross-references and citekeys.`;
    case "image-remote": return t`Images must be files in the collection (${value}).`;
    case "image-missing": return t`Image “${value}” is missing. Add it to the collection or correct its path.`;
    case "footnote-unused": return t`Footnote [^${value}] is never referenced.`;
    case "footnote-missing": return t`Footnote [^${value}] has no definition.`;
    case "footnote-duplicate": return t`Footnote [^${value}] is referenced more than once.`;
    case "html-unsupported": return t`Raw HTML is not rendered in PDF output.`;
    case "block-unsupported": return t`Unsupported Markdown block: ${value}.`;
    case "math-unclosed": return t`Unclosed $$ math block.`;
    case "math-end-unmatched": {
      const end = `\\end{${value}}`;
      return t`Math: ${end} has no matching \\begin.`;
    }
    case "math-env-mismatch": {
      const end = `\\end{${value}}`, begin = `\\begin{${other}}`;
      return t`Math: ${end} closes ${begin}.`;
    }
    case "math-brace-unmatched": return t`Math: Unmatched closing brace.`;
    case "math-brace-unclosed": return t`Math: Unclosed brace.`;
    case "math-env-unclosed": {
      const begin = `\\begin{${value}}`;
      return t`Math: ${begin} is never closed.`;
    }
    case "math-delimiters": return t`Math: ${value} \\left but ${other} \\right.`;
    case "style-file-missing": return t`No file in the collection matches the citation style ${value}.`;
    case "template-file-missing": return t`No file in the collection matches the template ${value}.`;
    case "style-unknown": return t`Unknown citation style "${value}"; using ${other}.`;
    case "template-unknown": return t`Unknown template "${value}"; using article.`;
    case "citation-locale-missing": return t`Citations have no terms for "${value}"; they use ${other}.`;
    case "annotation-empty": return t`The annotation ${value} has no quotation to embed.`;
    case "annotation-uncited": return t`No source in the library matches ${value}, so the quotation from ${other} is not cited.`;
    case "record-unloaded": return t`${value} is not loaded; it was left out.`;
    case "embed-omitted": return t`The embed ![[${value}]] in ${other} was left out.`;
  }
}
