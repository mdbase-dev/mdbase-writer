// Messages between the app and the compile worker.
import type { CslItem, ManuscriptMeta, MetaField, WriterRecord } from "@mdbase-writer/core";

export interface WriterDiagnostic {
  readonly record: string;
  readonly from: number;
  readonly to: number;
  readonly severity: "error" | "warning";
  readonly message: string;
  /** Where the problem was found: the writer's own checks, or Typst. */
  readonly origin: "writer" | "typst";
  /** Set when the problem is in a manuscript setting (frontmatter) rather than the body. */
  readonly field?: MetaField;
  /** Set when a citation names a citekey or label that does not exist, for suggesting others. */
  readonly unknown?: { readonly kind: "citekey" | "label"; readonly key: string };
}

export interface BlockPosition {
  readonly record: string;
  /** Body offset of the block's start. */
  readonly offset: number;
  readonly page: number;
  /** Top of the block on its page, in pt. */
  readonly y: number;
}

/** A bibliography entry or generated citation note in the preview, for showing its source on a click. */
export interface SourceMark {
  readonly kind: "entry" | "note";
  readonly keys: readonly string[];
  /** Where a note's citation is in the text. */
  readonly record?: string;
  readonly offset?: number;
  readonly page: number;
  /** The passage's extent on its page, in pt from the top. */
  readonly top: number;
  readonly bottom: number;
}

export type ToWorker =
  | { readonly type: "init"; readonly library: readonly CslItem[]; readonly styles: readonly [string, string][]; readonly locales: readonly [string, string][]; readonly baseUrl: string }
  | { readonly type: "library"; readonly library: readonly CslItem[] }
  | { readonly type: "collection"; readonly recordPaths: readonly string[]; readonly filePaths: readonly string[] }
  /** For quoting embedded annotations: the records that are annotations, and each source record's citekey. */
  | { readonly type: "quotations"; readonly annotationPaths: readonly string[]; readonly sourceKeys: readonly [string, string][] }
  | { readonly type: "records"; readonly upsert: readonly WriterRecord[]; readonly remove?: readonly string[] }
  | { readonly type: "main"; readonly path: string }
  | { readonly type: "assets"; readonly files: readonly [string, Uint8Array][] }
  | { readonly type: "export-pdf"; readonly id: number };

export interface CompileResult {
  readonly type: "result";
  /** Increases with every compile. */
  readonly revision: number;
  /** Vector artifact for the renderer; absent when the document failed to compile. */
  readonly artifact?: Uint8Array;
  readonly diagnostics: readonly WriterDiagnostic[];
  readonly positions: readonly BlockPosition[];
  readonly marks: readonly SourceMark[];
  readonly meta: ManuscriptMeta;
  readonly order: readonly string[];
  readonly unloaded: readonly string[];
  /** Collection files whose bytes the worker needs. */
  readonly neededAssets: readonly string[];
  readonly labels: readonly string[];
  /** The bibliography entry for each cited source, as Typst markup (for hovers). */
  readonly references: readonly { readonly key: string; readonly text: string }[];
  readonly timings: { readonly assembleMs: number; readonly compileMs: number; readonly citations: string; readonly clusters: number };
}

export type FromWorker =
  | { readonly type: "ready"; readonly initMs: number }
  | CompileResult
  | { readonly type: "pdf"; readonly id: number; readonly bytes?: Uint8Array; readonly error?: string }
  | { readonly type: "failure"; readonly message: string };
