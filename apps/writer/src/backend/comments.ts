// Comment records as Writer writes them: mdbase.comment contract
// fields, mapped to and from a collection's own field names.
import type { JsonObject, PeopleDirectory } from "@mdbase-dev/sdk";
import { personKey, recordLink, type CommentPeople, type newCommentFields } from "@mdbase-dev/ui/comments";

export interface NewComment extends Readonly<Parameters<typeof newCommentFields>[0]> {
  readonly text: string;
  /** A stable name for this one comment, reused by its retries so it lands once. */
  readonly intent?: string;
}

/** Why new comments are not signed (see `CommentPeople.signing`). */
export type Signing = NonNullable<CommentPeople["signing"]>;

export interface People extends CommentPeople {
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
      return { names, me: { link: recordLink(me.person.path), name: me.person.name }, signing: { kind: "linked" }, ...settings };
    case "unlinked":
      return { names, signing: { kind: "unlinked" }, ...settings };
    // Never pick one of several claimants, or trust an invalid one.
    case "ambiguous":
    case "invalid":
      return { names, signing: { kind: "conflict", paths: me.paths }, ...settings };
  }
}

/** Contract fields under a collection type's own names (unmapped fields keep theirs). */
export function toLocal(fields: JsonObject, mapping: Readonly<Record<string, string>>): JsonObject {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [mapping[k] ?? k, v]));
}
