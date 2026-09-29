// Comment records as both backends write them: mdbase.comment contract
// fields, mapped to and from a collection's own field names.
import type { JsonObject, PeopleDirectory } from "@mdbase-dev/connect";
import { linkPath, recordLink, type CommentRecord, type CommentTarget } from "@mdbase-writer/core/comments";

export interface NewComment {
  /** Path of the commented record. */
  readonly document: string;
  readonly text: string;
  readonly target?: CommentTarget;
  /** The thread a reply belongs to. */
  readonly thread?: CommentRecord;
  /** A suggested edit: the text to put in place of the target's quote. */
  readonly replacement?: string;
}

export type CommentChange =
  | { readonly kind: "resolve"; readonly outcome?: "accepted" | "rejected" }
  | { readonly kind: "reopen" }
  | { readonly kind: "withdraw" };

/**
 * Whether new comments are signed, and if not, why: the account has no person
 * record here, several records (or an invalid one) claim it, Writer was not
 * allowed to see the account, or the account could not be checked.
 */
export type Signing =
  | { readonly kind: "linked" }
  | { readonly kind: "unlinked" }
  | { readonly kind: "conflict"; readonly paths: readonly string[] }
  | { readonly kind: "not-approved" }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Person records by link key (see `personKey`), and the signed-in account's own. */
export interface People {
  readonly names: ReadonlyMap<string, string>;
  /** The link to the signed-in account's person record, when it has exactly one. */
  readonly me?: { readonly link: string; readonly name: string };
  /** Unknown until the account has been checked. */
  readonly signing?: Signing;
  /** Where the account links itself to a person record (mdbase Editor's settings for this collection). */
  readonly settingsUrl?: string;
}

export const NO_PEOPLE: People = { names: new Map() };

/** People from Connect's directory: every person record's name, and how the account resolves. */
export function peopleFromDirectory({ account, me, people }: Pick<PeopleDirectory, "account" | "me" | "people">): People {
  const names = new Map(people.map((p) => [personKey(p.path), p.name]));
  const settings = account.personSettingsUrl ? { settingsUrl: account.personSettingsUrl } : {};
  switch (me.status) {
    case "linked":
      return { names, me: { link: personLink(me.person.path), name: me.person.name }, signing: { kind: "linked" }, ...settings };
    case "unlinked":
      return { names, signing: { kind: "unlinked" }, ...settings };
    // Never pick one of several claimants, or trust an invalid one.
    case "ambiguous":
    case "invalid":
      return { names, signing: { kind: "conflict", paths: me.paths }, ...settings };
  }
}

/** Why the account could not be checked, from the directory's problem. */
export function signingFromProblem(problem: { readonly code: string; readonly message?: string }): Signing {
  if (problem.code === "access_denied") return { kind: "not-approved" };
  return { kind: "unavailable", reason: problem.message ?? problem.code };
}

/** A record path or link, compared as links resolve: without `.md`, ignoring case. */
export const personKey = (pathOrLink: string) => linkPath(pathOrLink).replace(/\.md$/i, "").toLowerCase();

/** The display name for an author link: its person record's name, else the link's own text. */
export function personName(link: string | undefined, people: People): string | undefined {
  if (!link) return undefined;
  const key = personKey(link);
  const exact = people.names.get(key);
  if (exact) return exact;
  // `[[Alex Rivera]]` resolves by file name when that name is unique.
  if (!key.includes("/")) {
    const matches = [...people.names].filter(([path]) => path.endsWith(`/${key}`));
    if (matches.length === 1) return matches[0]?.[1];
  }
  const alias = /\|([^\]]+)\]\]/.exec(link)?.[1];
  return alias?.trim() || linkPath(link).split("/").pop() || undefined;
}

/** A new comment's path: `comments/` and a sortable, unique name. */
export function commentPath(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `comments/${stamp}-${Math.random().toString(36).slice(2, 8)}.md`;
}

/** The contract fields of a new comment. */
export function newCommentFields(input: NewComment, now: Date, author: string | undefined): JsonObject {
  const motivation = input.thread ? "replying" : input.replacement !== undefined ? "editing" : "commenting";
  return {
    document: recordLink(input.document),
    ...(input.thread ? { in_reply_to: recordLink(input.thread.path) } : {}),
    motivation,
    ...(input.target && !input.thread ? { target: input.target as unknown as JsonObject } : {}),
    ...(input.replacement !== undefined && !input.thread ? { suggestion: { replacement: input.replacement } } : {}),
    ...(input.thread ? {} : { status: "open" }),
    ...(author ? { created_by: author } : {}),
    created_at: now.toISOString(),
  };
}

/** The contract fields a change writes, and the body it leaves (undefined keeps it). */
export function changeFields(comment: CommentRecord, change: CommentChange, now: Date, author: string | undefined): { fields: JsonObject; body?: string } {
  const at = now.toISOString();
  switch (change.kind) {
    case "resolve":
      return {
        fields: {
          status: "resolved",
          resolved_at: at,
          ...(author ? { resolved_by: author } : {}),
          ...(change.outcome && comment.suggestion ? { suggestion: { ...comment.suggestion, outcome: change.outcome } } : {}),
          modified_at: at,
        },
      };
    case "reopen":
      // resolved_by and resolved_at stay as a record of the last resolution:
      // an update can set keys but not remove them.
      return { fields: { status: "open", modified_at: at } };
    case "withdraw":
      return { fields: { deleted_at: at, modified_at: at }, body: "" };
  }
}

/** Contract fields under a collection type's own names (unmapped fields keep theirs). */
export function toLocal(fields: JsonObject, mapping: Readonly<Record<string, string>>): JsonObject {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [mapping[k] ?? k, v]));
}

/** A record's frontmatter under the contract's names. */
export function toContract(frontmatter: JsonObject, mapping: Readonly<Record<string, string>>): JsonObject {
  const out: JsonObject = {};
  for (const [canonical, local] of Object.entries(mapping)) if (local in frontmatter) out[canonical] = frontmatter[local] as JsonObject[string];
  return out;
}

/** The stored link to a person record. */
export const personLink = (path: string) => recordLink(path);
