// Mirrors packages/ui/src/apps.ts in mdbase-reader; keep the two in step.
/** The mdbase apps a collection can be opened in, in the order the app menu lists them. */
export type MdbaseAppId = "editor" | "reader" | "writer";

export interface MdbaseApp {
  readonly id: MdbaseAppId;
  readonly name: string;
  readonly description: string;
  readonly url: string;
}

export const mdbaseApps: readonly MdbaseApp[] = [
  {
    id: "editor",
    name: "Editor",
    description: "Browse and edit records",
    url: "https://editor.mdbase.dev/",
  },
  {
    id: "reader",
    name: "Reader",
    description: "Read and annotate sources",
    url: "https://reader.mdbase.dev/",
  },
  {
    id: "writer",
    name: "Writer",
    description: "Write manuscripts that cite your sources",
    url: "https://lab.mdbase-writer.pages.dev/",
  },
];

/**
 * Parameters every mdbase app reads the same way: `collection` is the Connect SDK's
 * selection and `server` picks a non-default Connect server. App-specific parameters
 * (Reader's `source`, Writer's `manuscript`) mean nothing to another app, so they stay behind.
 */
const sharedParameters = ["collection", "server"] as const;

/** A link that opens the current page's collection in another app. */
export function mdbaseAppHref(appUrl: string, currentHref: string): string {
  const target = new URL(appUrl);
  const current = new URL(currentHref);
  for (const key of sharedParameters) {
    const value = current.searchParams.get(key);
    if (value) {
      target.searchParams.set(key, value);
    }
  }
  return target.href;
}
