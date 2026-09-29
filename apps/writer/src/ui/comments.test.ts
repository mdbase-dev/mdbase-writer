import { commentFromRecord, type CommentRecord } from "@mdbase-writer/core/comments";
import { describe, expect, it } from "vitest";

import { changeFields, newCommentFields, peopleFromDirectory, personName, signingFromProblem, toContract, toLocal } from "../backend/comments.js";
import { anchorsFor, describeSuggestion, placeThreads } from "./comments.js";

const body = "# Method\n\nThe evidence suggests strongly that it works.\n";
const comment = (path: string, fields: Record<string, unknown>) =>
  commentFromRecord(path, { document: "[[chapters/method]]", created_at: "2026-09-29T10:00:00Z", ...fields }, "text") as CommentRecord;

describe("placing threads", () => {
  const onPassage = comment("comments/a.md", { target: { quote: { exact: "suggests strongly" } } });
  const whole = comment("comments/b.md", { created_at: "2026-09-29T11:00:00Z" });
  const detached = comment("comments/c.md", { target: { quote: { exact: "no longer here" } } });
  const elsewhere = comment("comments/d.md", { document: "[[notes/other]]" });
  const withdrawn = comment("comments/e.md", { deleted_at: "2026-09-29T12:00:00Z" });
  const suggestion = comment("comments/f.md", { motivation: "editing", target: { quote: { exact: " strongly" } }, suggestion: { replacement: "" } });
  const resolved = comment("comments/g.md", { status: "resolved", target: { quote: { exact: "it works" } } });
  const all = [detached, onPassage, whole, elsewhere, withdrawn, suggestion, resolved];
  const recordPaths = ["manuscripts/paper.md", "chapters/method.md", "notes/other.md"];
  const placed = placeThreads(all, ["manuscripts/paper.md", "chapters/method.md"], (p) => (p === "chapters/method.md" ? body : ""), recordPaths);

  it("keeps the manuscript's threads in reading order, detached last", () => {
    expect(placed.map((p) => p.thread.root.path)).toEqual(["comments/b.md", "comments/a.md", "comments/f.md", "comments/g.md", "comments/c.md"]);
    expect(placed.at(-1)?.at).toBeNull();
    expect(placed[0]?.at).toBe("whole");
  });

  it("anchors only open threads on a passage in the editor", () => {
    const anchors = anchorsFor(placed, "chapters/method.md");
    expect(anchors.map((a) => a.id)).toEqual(["comments/a.md", "comments/f.md"]);
    expect(anchors[1]?.replacement).toBe("");
    expect(anchorsFor(placed, "manuscripts/paper.md")).toEqual([]);
  });

  it("describes suggestions", () => {
    expect(describeSuggestion(suggestion)).toBe("Delete “strongly”");
    expect(describeSuggestion({ ...suggestion, suggestion: { replacement: "shows" } })).toBe("Replace “strongly” with “shows”");
    expect(describeSuggestion({ ...suggestion, target: { quote: { exact: "", prefix: "a" } }, suggestion: { replacement: "x" } })).toBe("Insert “x”");
  });
});

describe("writing comments", () => {
  const now = new Date("2026-09-29T10:00:00Z");

  it("writes a thread, a suggestion and a reply through the contract's fields", () => {
    const target = { quote: { exact: "x" } };
    expect(newCommentFields({ document: "chapters/method.md", text: "Hm", target }, now, "[[people/me]]")).toEqual({
      document: "[[chapters/method]]",
      motivation: "commenting",
      target,
      status: "open",
      created_by: "[[people/me]]",
      created_at: "2026-09-29T10:00:00.000Z",
    });
    expect(newCommentFields({ document: "chapters/method.md", text: "", target, replacement: "" }, now, undefined)).toMatchObject({ motivation: "editing", suggestion: { replacement: "" } });
    const thread = comment("comments/a.md", {});
    const reply = newCommentFields({ document: "chapters/method.md", text: "Yes", thread, target }, now, undefined);
    expect(reply).toEqual({ document: "[[chapters/method]]", in_reply_to: "[[comments/a]]", motivation: "replying", created_at: "2026-09-29T10:00:00.000Z" });
  });

  it("resolves, records a suggestion's outcome, and withdraws by emptying", () => {
    const s = comment("comments/f.md", { motivation: "editing", target: { quote: { exact: "x" } }, suggestion: { replacement: "y" } });
    expect(changeFields(s, { kind: "resolve", outcome: "accepted" }, now, "[[people/me]]").fields).toMatchObject({ status: "resolved", resolved_by: "[[people/me]]", suggestion: { replacement: "y", outcome: "accepted" } });
    expect(changeFields(s, { kind: "withdraw" }, now, undefined)).toMatchObject({ fields: { deleted_at: "2026-09-29T10:00:00.000Z" }, body: "" });
  });

  it("maps to and from a collection's own field names", () => {
    const mapping = { document: "on", created_at: "created" };
    expect(toLocal({ document: "[[a]]", created_at: "t", motivation: "commenting" }, mapping)).toEqual({ on: "[[a]]", created: "t", motivation: "commenting" });
    expect(toContract({ on: "[[a]]", created: "t", other: 1 }, mapping)).toEqual({ document: "[[a]]", created_at: "t" });
  });
});

describe("author names", () => {
  const people = { names: new Map([["people/alex rivera", "Alex Rivera"], ["people/sam", "Sam Okafor"]]) };

  it("uses the person record's name, found by path or unique file name", () => {
    expect(personName("[[people/sam]]", people)).toBe("Sam Okafor");
    expect(personName("[[Alex Rivera]]", people)).toBe("Alex Rivera");
  });

  it("falls back to the link's own text", () => {
    expect(personName("[[people/Gone Person]]", people)).toBe("Gone Person");
    expect(personName("[[people/x|Xavier]]", people)).toBe("Xavier");
    expect(personName(undefined, people)).toBeUndefined();
  });
});

describe("signing comments", () => {
  const account = { issuer: "https://mdbase.dev", subject: "acct_1", name: "Callum", personSettingsUrl: "https://editor.example/?surface=settings#your-person" };
  const person = { path: "people/Callum Alpass.md", name: "Callum Alpass", identities: [], typeNames: ["person"] };

  it("signs with the one person record linked to the account", () => {
    const people = peopleFromDirectory({ account, me: { status: "linked", person }, people: [person] });
    expect(people.signing).toEqual({ kind: "linked" });
    expect(people.me).toEqual({ link: "[[people/Callum Alpass]]", name: "Callum Alpass" });
    expect(people.names.get("people/callum alpass")).toBe("Callum Alpass");
  });

  it("does not sign, and says where to link, when no record is linked", () => {
    const people = peopleFromDirectory({ account, me: { status: "unlinked" }, people: [person] });
    expect(people.signing).toEqual({ kind: "unlinked" });
    expect(people.me).toBeUndefined();
    expect(people.settingsUrl).toBe(account.personSettingsUrl);
  });

  it("never picks one of several claimants, or an invalid one", () => {
    expect(peopleFromDirectory({ account, me: { status: "ambiguous", paths: ["a.md", "b.md"] }, people: [] })).toMatchObject({ signing: { kind: "conflict", paths: ["a.md", "b.md"] } });
    expect(peopleFromDirectory({ account, me: { status: "invalid", paths: ["a.md"] }, people: [] }).me).toBeUndefined();
  });

  it("tells a declined identity permission from an unavailable account", () => {
    expect(signingFromProblem({ code: "access_denied", message: "not approved" })).toEqual({ kind: "not-approved" });
    expect(signingFromProblem({ code: "temporarily_unavailable", message: "Account identity information is unavailable." })).toEqual({ kind: "unavailable", reason: "Account identity information is unavailable." });
  });
});
