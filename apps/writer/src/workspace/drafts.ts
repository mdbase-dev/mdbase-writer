import type { JsonObject } from "@mdbase-dev/connect";

export interface LocalDraft {
  readonly version: 1;
  readonly body: string;
  readonly frontmatter: JsonObject;
  readonly baseBody: string;
  readonly baseFrontmatter: JsonObject;
  readonly revision: string;
  readonly updated: string;
}

/** Local, unsent drafts, isolated by collection and record. Never store credentials. */
function browserStorage(): Storage | undefined {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
}

export class DraftStore {
  constructor(private readonly namespace: string, private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined = browserStorage()) {}
  private key(path: string) { return `mdbase-writer:draft:${encodeURIComponent(this.namespace)}:${encodeURIComponent(path)}`; }
  read(path: string): LocalDraft | null {
    try {
      const value: unknown = JSON.parse(this.storage?.getItem(this.key(path)) ?? "null");
      if (!value || typeof value !== "object") return null;
      const draft = value as LocalDraft;
      return draft.version === 1 && typeof draft.body === "string" && typeof draft.baseBody === "string" && typeof draft.revision === "string" && typeof draft.updated === "string" && isObject(draft.frontmatter) && isObject(draft.baseFrontmatter) ? draft : null;
    } catch { return null; }
  }
  write(path: string, draft: LocalDraft): boolean {
    try {
      if (!this.storage) return false;
      this.storage.setItem(this.key(path), JSON.stringify(draft));
      return true;
    } catch { return false; }
  }
  remove(path: string): void {
    try { this.storage?.removeItem(this.key(path)); } catch { /* Keep recovery available if storage is locked. */ }
  }
  /** Every record with a draft in this namespace, newest first (for the home screen). */
  list(): { path: string; updated: string }[] {
    const out: { path: string; updated: string }[] = [];
    try {
      const store = this.storage as (Storage | undefined);
      const prefix = `mdbase-writer:draft:${encodeURIComponent(this.namespace)}:`;
      const keys = store && typeof store.length === "number" ? Array.from({ length: store.length }, (_, i) => store.key(i)) : [];
      for (const key of keys) {
        if (!key?.startsWith(prefix)) continue;
        const path = decodeURIComponent(key.slice(prefix.length));
        const draft = this.read(path);
        if (draft) out.push({ path, updated: draft.updated });
      }
    } catch { /* Nothing listed when storage is locked. */ }
    return out.sort((a, b) => b.updated.localeCompare(a.updated));
  }
}
const isObject = (value: unknown): value is JsonObject => Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Only local changes, not stale copies of unrelated remote fields, are restored. */
export function draftPatch(draft: LocalDraft): JsonObject {
  return Object.fromEntries(Object.entries(draft.frontmatter).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(draft.baseFrontmatter[key])));
}
