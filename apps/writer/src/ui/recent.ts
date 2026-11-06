// What this browser remembers about a collection's manuscripts for the home
// screen: which were opened last, and a writing goal for each. Both are
// conveniences kept in local storage, isolated by collection; nothing here
// is written to the collection.

export interface RecentEntry {
  readonly path: string;
  /** When it was last opened (ISO 8601). */
  readonly at: string;
  readonly chapter?: string;
  readonly position?: WritingPosition;
}

export interface WritingPosition {
  readonly path: string;
  readonly anchor: number;
  readonly head: number;
  readonly top: number;
  readonly offset: number;
}

const RECENT_KEPT = 8;

function storage(): Storage | undefined {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
}
const recentKey = (namespace: string) => `mdbase-writer:recent:${encodeURIComponent(namespace)}`;
const goalKey = (namespace: string, path: string) => `mdbase-writer:goal:${encodeURIComponent(namespace)}:${encodeURIComponent(path)}`;

export function recentManuscripts(namespace: string, store: Pick<Storage, "getItem"> | undefined = storage()): RecentEntry[] {
  try {
    const value: unknown = JSON.parse(store?.getItem(recentKey(namespace)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry: Partial<RecentEntry> | null) => {
      if (!entry || typeof entry.path !== "string" || typeof entry.at !== "string") return [];
      const position = entry.position;
      const validPosition = position && typeof position.path === "string" && [position.anchor, position.head, position.top].every(number => Number.isSafeInteger(number) && number >= 0) && Number.isFinite(position.offset);
      return [{ path: entry.path, at: entry.at, ...(typeof entry.chapter === "string" ? { chapter: entry.chapter } : {}), ...(validPosition ? { position } : {}) }];
    });
  } catch {
    return [];
  }
}

/** Notes that `path` was opened now; it moves to the front of the list. */
export function recordOpened(namespace: string, path: string, store: Pick<Storage, "getItem" | "setItem"> | undefined = storage(), now = new Date(), chapter?: string, position?: WritingPosition): void {
  try {
    const previous = recentManuscripts(namespace, store);
    const lastChapter = position ? position.path : chapter ?? previous.find(entry => entry.path === path)?.chapter;
    const lastPosition = position ?? previous.find(entry => entry.path === path)?.position;
    const rest = previous.filter((e) => e.path !== path);
    store?.setItem(recentKey(namespace), JSON.stringify([{ path, at: now.toISOString(), ...(lastChapter ? { chapter: lastChapter } : {}), ...(lastPosition ? { position: lastPosition } : {}) }, ...rest].slice(0, RECENT_KEPT)));
  } catch {
    // Storage may be unavailable; the home screen then has no "continue" card.
  }
}

/** A manuscript's word goal in this browser, or null. */
export function wordGoal(namespace: string, path: string, store: Pick<Storage, "getItem"> | undefined = storage()): number | null {
  try {
    const n = Number(store?.getItem(goalKey(namespace, path)));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  } catch {
    return null;
  }
}

export function setWordGoal(namespace: string, path: string, goal: number | null, store: Pick<Storage, "setItem" | "removeItem"> | undefined = storage()): void {
  try {
    if (goal && goal > 0) store?.setItem(goalKey(namespace, path), String(Math.round(goal)));
    else store?.removeItem(goalKey(namespace, path));
  } catch {
    // Storage may be unavailable; the goal lasts for this page.
  }
}

/** The namespace a backend's local state is kept under (shared with local drafts). */
export const localNamespace = (backend: { readonly kind: string; readonly collectionName: string; readonly draftNamespace?: string | undefined }) =>
  backend.draftNamespace ?? `${backend.kind}:${backend.collectionName}`;
