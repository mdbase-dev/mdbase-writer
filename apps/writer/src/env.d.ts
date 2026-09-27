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
