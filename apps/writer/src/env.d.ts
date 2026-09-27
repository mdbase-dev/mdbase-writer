/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_MDBASE_CONNECT_URL?: string;
  readonly VITE_MDBASE_CONNECT_LOOPBACK_URL?: string;
  readonly VITE_WRITER_DEMO?: string;
  readonly VITE_MDBASE_EDITOR_URL?: string;
  readonly VITE_MDBASE_READER_URL?: string;
  readonly VITE_MDBASE_WRITER_URL?: string;
}
declare module "*.json" {
  const value: unknown;
  export default value;
}

declare module "pandoc-wasm/core" {
  export interface PandocResult {
    readonly stdout: string;
    readonly stderr: string;
    readonly warnings: readonly unknown[];
    readonly files: Record<string, Blob>;
  }
  export interface PandocInstance {
    convert(options: Record<string, unknown>, stdin: string | null, files: Record<string, string | Blob>): Promise<PandocResult>;
  }
  export function createPandocInstance(wasm: ArrayBuffer): Promise<PandocInstance>;
}
declare module "pandoc-wasm/pandoc.wasm?url" {
  const url: string;
  export default url;
}
