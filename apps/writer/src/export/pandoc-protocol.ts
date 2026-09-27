// Messages between the app and the Pandoc worker.
export interface ToPandoc {
  readonly id: number;
  readonly baseUrl: string;
  /** Pandoc Markdown with cross-references resolved. */
  readonly markdown: string;
  /** Files beside it: references.json, style.csl, reference.docx, media/…. */
  readonly files: readonly (readonly [string, string | Uint8Array])[];
}

export type FromPandoc =
  | { readonly id: number; readonly bytes: Uint8Array; readonly warnings: readonly string[]; readonly error?: undefined }
  | { readonly id: number; readonly error: string; readonly bytes?: undefined };
