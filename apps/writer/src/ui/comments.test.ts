import { commentFromRecord, type CommentRecord } from "@mdbase-dev/ui/comments";
import { describe, expect, it } from "vitest";

import { peopleFromDirectory, toLocal } from "../backend/comments.js";
import { PathIndex } from "@mdbase-writer/core/records";
import { anchorsFor, placeThreads, ThreadPlacement } from "./comments.js";

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

  it("reuses placement on save-state changes and re-anchors only changed manuscript bodies", () => {
    const comments = [onPassage, comment("comments/main.md", { document: "[[manuscripts/paper]]", target: { quote: { exact: "main" } } }), elsewhere];
    const index = new PathIndex(recordPaths);
    const cache = new ThreadPlacement();
    const order = ["manuscripts/paper.md", "chapters/method.md"];
    const bodies = new Map([[order[0]!, "main"], [order[1]!, body]]);
    const read = (path: string) => { expect(path).not.toBe("notes/other.md"); return bodies.get(path); };
    const before = cache.place(comments, order, read, index);
    expect(cache.place(comments, order, read, index)).toBe(before);
    bodies.set(order[1]!, `New prefix\n${body}`);
    const after = cache.place(comments, order, read, index);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1]?.at).toMatchObject({ from: body.indexOf("suggests strongly") + 11 });
    expect(cache.place(comments, [order[0]!], read, index)).toEqual([before[0]]);
    // A new generation introduces basename ambiguity; membership is resolved again.
    const bare = [{ ...onPassage, document: "[[method]]" }];
    expect(cache.place(bare, order, read, index)).toHaveLength(1);
    expect(cache.place(bare, order, read, new PathIndex([...recordPaths, "other/method.md"]))).toEqual([]);
  });
});

describe("writing comments", () => {

  it("maps to and from a collection's own field names", () => {
    const mapping = { document: "on", created_at: "created" };
    expect(toLocal({ document: "[[a]]", created_at: "t", motivation: "commenting" }, mapping)).toEqual({ on: "[[a]]", created: "t", motivation: "commenting" });
  });
});


describe("signing comments", () => {
  const account = { issuer: "https://mdbase.dev", subject: "acct_1", name: "Callum", personSettingsUrl: "https://editor.example/?surface=settings#your-person" };
  const person = { path: "people/Callum Alpass.md", name: "Callum Alpass", id: "person-id", identities: [], typeNames: ["person"] };

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

});
