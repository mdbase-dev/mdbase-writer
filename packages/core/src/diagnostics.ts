/** Stable, serializable UI-copy metadata. English diagnostics stay available to CLI
 * consumers; applications localize only their presentation, never manuscript text. */
export interface DiagnosticCopy {
  readonly code:
    | "embed-missing" | "embed-cycle" | "label-duplicate" | "label-missing"
    | "citekey-missing" | "citation-mixed" | "image-remote" | "image-missing"
    | "footnote-unused" | "footnote-missing" | "footnote-duplicate"
    | "html-unsupported" | "block-unsupported" | "math-unclosed"
    | "math-end-unmatched" | "math-env-mismatch" | "math-brace-unmatched"
    | "math-brace-unclosed" | "math-env-unclosed" | "math-delimiters"
    | "style-file-missing" | "template-file-missing" | "style-unknown"
    | "template-unknown" | "citation-locale-missing"
    | "annotation-empty" | "annotation-uncited" | "record-unloaded" | "embed-omitted";
  readonly values?: readonly (string | number)[];
}
