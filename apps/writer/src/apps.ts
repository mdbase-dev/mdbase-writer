// The other mdbase apps: local builds point at local copies of them.
import { mdbaseAppHref, withAppUrls } from "@mdbase-dev/ui/apps";

export const appUrls = {
  editor: import.meta.env.VITE_MDBASE_EDITOR_URL,
  reader: import.meta.env.VITE_MDBASE_READER_URL,
  writer: import.meta.env.VITE_MDBASE_WRITER_URL,
};

/** A link that opens a source in Reader, in this page's collection (Reader names a source by its path). */
export function readerSourceHref(sourcePath: string): string | undefined {
  const reader = withAppUrls(appUrls).find((a) => a.id === "reader");
  if (!reader) return undefined;
  const href = new URL(mdbaseAppHref(reader.url, location.href));
  href.searchParams.set("source", sourcePath);
  return href.href;
}
