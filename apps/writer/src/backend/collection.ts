// Collection semantics, independent of queries, watches and record sessions.
import type { CollectionDescription, JsonObject, QuerySelectionExpression } from "@mdbase-dev/connect";
import { annotationSourceLink } from "@mdbase-writer/core/annotations";
import { commentFromRecord, linkPath, type CommentRecord } from "@mdbase-writer/core/comments";
import { PathIndex, pathIndex, resolveLinkTarget } from "@mdbase-writer/core/records";
import { personKey, toContract } from "./comments.js";
import { fail, libraryEntry, ok, type CollectionDelta, type CollectionIndex, type LibraryEntry, type ManuscriptSummary } from "./types.js";

export const manuscriptContract = { id: "dev.mdbase.writer.manuscript", version: "1.0.0-beta.2" } as const;
export const sourceContract = { id: "dev.mdbase.reader.source", version: "1.0.0-beta.1" } as const;
export const annotationContract = { id: "dev.mdbase.reader.annotation", version: "1.0.0-beta.1" } as const;
export const commentContract = { id: "mdbase.comment", version: "1.0.0" } as const;

const domains = {
  manuscript: { contract: manuscriptContract, starter: "writer-manuscript", note: true },
  source: { contract: sourceContract, starter: "reader-source", note: false },
  annotation: { contract: annotationContract, starter: "reader-annotation", note: false },
  comment: { contract: commentContract, starter: "comment", note: false },
  person: { contract: { id: "mdbase.person", version: "2.0.0" }, starter: "person", note: false },
} as const;
export type Domain = keyof typeof domains;
/** The demo's starter definitions, derived from the same domain table. */
export function starterSchema(): CollectionSchema {
  return new CollectionSchema({
    types: Object.values(domains).map((d) => ({ name: d.starter, schema: {}, extensions: {} })),
    contracts: Object.values(domains).map((d) => ({
      ...d.contract, contractType: "record", digest: "demo", schema: {},
      implementations: [{ typeName: d.starter, typeVersion: 1, digest: "demo", fields: {} }],
    })),
  });
}
export interface Binding { readonly name: string; readonly fields: Readonly<Record<string, string>>; readonly typeKey: string }
interface RoleBinding extends Binding { readonly active: boolean }
export interface CollectionRow {
  readonly path: string;
  readonly types: readonly string[];
  readonly frontmatter?: JsonObject;
  readonly effectiveFrontmatter?: JsonObject;
  /** Narrow query values are partial metadata, never a full record/frontmatter. */
  readonly values?: JsonObject;
  readonly file?: { readonly mtime?: string };
}
export interface AnnotationMetadata { readonly path: string; readonly type: string; readonly source: string; readonly fields: Readonly<Record<string, string>> }
export interface CommentMetadata { readonly type: string; readonly fields: Readonly<Record<string, string>>; readonly comment: Pick<CommentRecord, "document" | "inReplyTo"> }
export interface StoreDelta extends CollectionDelta {
  /** Null means source membership changed: previously ambiguous links may now resolve. */
  readonly annotationSources?: readonly string[] | null;
}
interface Classified {
  note: boolean;
  effective: boolean;
  source?: LibraryEntry;
  manuscript?: ManuscriptSummary;
  annotation?: AnnotationMetadata;
  comment?: CommentMetadata;
  person?: string;
}
const equal = (a: unknown, b: unknown) => a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));
const fieldsOf = (fm: JsonObject, binding: Binding) => Object.keys(binding.fields).length ? toContract(fm, binding.fields) : fm;

/** One binding table serves discovery, writes, sessions and incremental classification. */
export class CollectionSchema {
  private readonly byType = new Map<string, Map<Domain, RoleBinding>>();
  private readonly roleCache = new Map<string, ReadonlyMap<Domain, RoleBinding>>();
  constructor(readonly description: Pick<CollectionDescription, "types" | "contracts" | "configuration">) {
    for (const domain of Object.keys(domains) as Domain[]) {
      const rule = domains[domain];
      const implementations = description.contracts.find((c) => c.id === rule.contract.id)?.implementations ?? [];
      const bindings = implementations.map((i) => ({ name: i.typeName, fields: i.fields, typeKey: this.typeKey }));
      // Recognise starter records even when their type isn't installed/described yet.
      if (!bindings.some((b) => b.name === rule.starter)) bindings.push({ name: rule.starter, fields: {}, typeKey: this.typeKey });
      const loaded = this.bindings(domain, domain === "manuscript");
      const active = new Set(loaded.ok ? loaded.value.map((b) => b.name) : []);
      for (const binding of bindings) {
        let roles = this.byType.get(binding.name);
        if (!roles) this.byType.set(binding.name, roles = new Map());
        const fields = domain === "annotation" ? { source: "source", locator: "locator", ...binding.fields } : binding.fields;
        roles.set(domain, { ...binding, fields, active: active.has(binding.name) });
      }
    }
  }
  private get typeKey(): string {
    const settings = this.description.configuration?.["settings"] as JsonObject | undefined;
    const keys = settings?.["explicit_type_keys"];
    return Array.isArray(keys) && typeof keys[0] === "string" ? keys[0] : "type";
  }
  bindings(domain: Domain, required = false) {
    const rule = domains[domain];
    const contract = this.description.contracts.find((c) => c.id === rule.contract.id);
    const implementations = contract?.implementations ?? [];
    if (implementations.length) return ok(implementations.map((i) => ({ name: i.typeName, fields: i.fields, typeKey: this.typeKey })));
    if (required || (contract && domain === "annotation")) return fail<Binding[]>(`This collection has no type for ${domain}s. Set it up again from mdbase connect.`);
    if (contract) return ok<Binding[]>([]);
    if (domain === "comment" || domain === "person") return ok<Binding[]>([]);
    const starter = this.description.types.some((t) => t.name === rule.starter);
    return ok(starter ? [{ name: rule.starter, fields: {}, typeKey: this.typeKey }] : []);
  }
  roles(types: readonly string[]): ReadonlyMap<Domain, RoleBinding> {
    const key = types.join("\0"), cached = this.roleCache.get(key);
    if (cached) return cached;
    const roles = new Map<Domain, RoleBinding>();
    for (const type of types) {
      for (const [domain, binding] of this.byType.get(type) ?? []) if (!roles.has(domain)) roles.set(domain, binding);
    }
    this.roleCache.set(key, roles);
    return roles;
  }
  /** Classification fields across bindings: query types do not exclude co-typed roles. */
  discoverySelect(): QuerySelectionExpression[] {
    const needed: Record<Domain, readonly string[]> = {
      source: ["csl", "title"], manuscript: ["title", "template", "csl"],
      annotation: ["source"], comment: ["document", "created_at", "in_reply_to"], person: ["name"],
    };
    const fields = new Set<string>();
    let modified = false;
    for (const role of this.byType.values()) for (const [domain, binding] of role) {
      if (!binding.active) continue;
      modified ||= domain === "manuscript" || domain === "source";
      for (const field of needed[domain]) fields.add(binding.fields[field] ?? field);
    }
    return [
      ...[...fields].map((field) => ({ name: field, expression: `record[${JSON.stringify(field)}]` })),
      // Output aliases are field names: dots are valid in expressions, not names.
      ...(modified ? [{ name: "file_mtime", expression: "file.mtime" }] : fields.size ? [] : [{ name: "file_path", expression: "file.path" }]),
    ];
  }
  annotationFields(types: readonly string[]): Readonly<Record<string, string>> {
    const binding = this.roles(types).get("annotation");
    return binding?.fields ?? {};
  }
  get setupStatus() {
    const configured = (domain: Domain) => this.description.contracts.some((c) => c.id === domains[domain].contract.id) || this.description.types.some((t) => t.name === domains[domain].starter);
    const comments = this.bindings("comment");
    return { sources: configured("source"), annotations: configured("annotation"), comments: comments.ok && comments.value.length > 0 };
  }
}

/** Keeps only domain metadata, not whole query rows/frontmatter or bodies. */
export class CollectionStore {
  private readonly records = new Map<string, Classified>();
  private readonly binaries = new Set<string>();
  readonly annotations = new Map<string, AnnotationMetadata>();
  readonly comments = new Map<string, CommentMetadata>();
  readonly people = new Map<string, string>();
  private readonly sources = new Map<string, LibraryEntry>();
  private readonly papers = new Map<string, ManuscriptSummary>();
  private indexValue: CollectionIndex | undefined;
  private libraryValue: LibraryEntry[] | undefined;
  private manuscriptValue: ManuscriptSummary[] | undefined;
  private sourceIndexValue: PathIndex | undefined;
  private recordIndexValue: PathIndex | undefined;
  private annotationGroups: Map<string, Map<string, AnnotationMetadata>> | undefined;
  constructor(public schema: CollectionSchema) {}

  get index(): CollectionIndex {
    return this.indexValue ??= { recordPaths: [...this.records.keys()], notePaths: [...this.records].filter(([, r]) => r.note).map(([p]) => p), filePaths: [...this.binaries] };
  }
  get library(): LibraryEntry[] { return this.libraryValue ??= [...this.sources.values()].sort((a, b) => a.path.localeCompare(b.path)); }
  get manuscripts(): ManuscriptSummary[] { return this.manuscriptValue ??= [...this.papers.values()].sort((a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path)); }
  get sourceIndex(): PathIndex { return this.sourceIndexValue ??= new PathIndex(this.sources.keys()); }
  get recordIndex(): PathIndex { return this.recordIndexValue ??= pathIndex(this.index.recordPaths); }

  private classify(row: CollectionRow, previous: Classified | undefined, discovery: boolean): Classified {
    const fm = row.values ?? row.frontmatter ?? row.effectiveFrontmatter ?? {};
    const effective = row.effectiveFrontmatter ?? fm;
    // Independent discovery queries can finish in any order. Persisted index rows
    // must not overwrite defaults already learned from effective domain queries.
    const retainEffective = discovery && row.effectiveFrontmatter === undefined && previous?.effective;
    const next: Classified = { note: /\.md$/i.test(row.path), effective: row.effectiveFrontmatter !== undefined || !!retainEffective };
    for (const [domain, binding] of this.schema.roles(row.types)) {
      if (!domains[domain].note) next.note = false;
      if (!binding.active) continue;
      switch (domain) {
        case "source": {
          const written = row.values?.["file_mtime"] ?? row.file?.mtime;
          const source = retainEffective && previous.source ? previous.source : libraryEntry(row.path, fieldsOf(effective, binding), typeof written === "string" ? written : undefined);
          if (source) next.source = equal(previous?.source, source) ? previous!.source! : source;
          break;
        }
        case "manuscript": {
          const fields = fieldsOf(effective, binding);
          const modified = row.values?.["file_mtime"] ?? row.file?.mtime;
          const manuscript = retainEffective && previous.manuscript ? previous.manuscript : {
            path: row.path, title: typeof fields["title"] === "string" ? fields["title"] : row.path,
            ...(typeof fields["template"] === "string" ? { template: fields["template"] } : {}),
            ...(typeof fields["csl"] === "string" ? { style: fields["csl"] } : {}),
            ...(typeof modified === "string" ? { modified } : {}),
          };
          next.manuscript = equal(previous?.manuscript, manuscript) ? previous!.manuscript! : manuscript;
          break;
        }
        case "annotation": {
          const target = fm[binding.fields["source"] ?? "source"];
          next.annotation = { path: row.path, type: binding.name, fields: binding.fields, source: typeof target === "string" ? annotationSourceLink(target) ?? "" : "" };
          break;
        }
        case "comment": {
          const comment = commentFromRecord(row.path, fieldsOf(fm, binding), "");
          if (comment) {
            const metadata = { type: binding.name, fields: binding.fields,
              comment: { document: comment.document, ...(comment.inReplyTo ? { inReplyTo: comment.inReplyTo } : {}) } };
            next.comment = discovery && previous?.comment && equal(previous.comment, metadata) ? previous.comment : metadata;
          }
          break;
        }
        case "person": {
          const name = fieldsOf(effective, binding)["name"];
          if (typeof name === "string") next.person = name;
          break;
        }
      }
    }
    return next;
  }
  /** Discovery omits cumulative snapshots and merges partial persisted/effective views. */
  upsert(rows: readonly CollectionRow[], discovery = false): StoreDelta { return this.apply(rows, [], discovery); }
  remove(paths: readonly string[]): StoreDelta { return this.apply([], paths); }
  reset(): StoreDelta {
    const paths = [...this.records.keys(), ...this.binaries];
    const delta = this.remove(paths);
    const files = this.files([], [...this.binaries]);
    return { ...delta, ...files, paths, reset: true, annotationSources: null };
  }
  /** Binary descriptors belong to the adapter; the store only needs membership. */
  files(paths: readonly string[], removed: readonly string[] = []): StoreDelta {
    let changed = false;
    for (const path of removed) if (this.binaries.delete(path)) changed = true;
    for (const path of paths) if (!/\.md$/i.test(path) && !this.binaries.has(path)) { this.binaries.add(path); changed = true; }
    if (!changed) return { paths: [...paths, ...removed] };
    this.indexValue = undefined;
    return { paths: [...paths, ...removed], index: this.index };
  }
  private apply(rows: readonly CollectionRow[], removed: readonly string[], discovery = false): StoreDelta {
    let index = false, library = false, manuscripts = false, annotations = false, comments = false, membership = false;
    const affected = new Set<string>();
    const changes: [string, CollectionRow | undefined][] = [
      ...rows.map((r): [string, CollectionRow] => [r.path, r]),
      ...removed.map((p): [string, undefined] => [p, undefined]),
    ];
    for (const [path, row] of changes) {
      const old = this.records.get(path);
      const next = row && this.classify(row, old, discovery);
      index ||= !!old !== !!next || old?.note !== next?.note;
      if (old?.source || next?.source) library ||= !equal(old?.source, next?.source);
      if (old?.manuscript || next?.manuscript) manuscripts ||= !equal(old?.manuscript, next?.manuscript);
      membership ||= !!old?.source !== !!next?.source;
      if (old?.annotation || next?.annotation) {
        annotations = true;
        for (const [a, remove] of [[old?.annotation, true], [next?.annotation, false]] as const) {
          if (!a) continue;
          const target = this.annotationGroups && resolveLinkTarget(a.source, path, this.sourceIndex);
          if (!target) continue;
          affected.add(target);
          if (remove) this.annotationGroups?.get(target)?.delete(path);
          else if (this.annotationGroups) {
            if (!this.annotationGroups.has(target)) this.annotationGroups.set(target, new Map());
            this.annotationGroups.get(target)!.set(path, a);
          }
        }
      }
      comments ||= !!old?.comment || !!next?.comment;
      if (next) this.records.set(path, next); else this.records.delete(path);
      if (old?.source || next?.source) this.set(this.sources, path, next?.source);
      if (old?.manuscript || next?.manuscript) this.set(this.papers, path, next?.manuscript);
      // Body-only watch changes still fence any in-flight lazy body read.
      if (next?.annotation) this.annotations.set(path, next.annotation); else if (old?.annotation) this.annotations.delete(path);
      if (next?.comment) this.comments.set(path, next.comment); else if (old?.comment) this.comments.delete(path);
      if (old?.person || next?.person) this.set(this.people, personKey(path), next?.person);
    }
    if (index) { this.indexValue = undefined; this.recordIndexValue = undefined; }
    if (library) this.libraryValue = undefined;
    if (manuscripts) this.manuscriptValue = undefined;
    if (membership) { this.sourceIndexValue = undefined; this.annotationGroups = undefined; }
    return {
      paths: changes.map(([p]) => p), ...(index && !discovery ? { index: this.index } : {}),
      ...(library && !discovery ? { library: this.library } : {}), ...(manuscripts && !discovery ? { manuscripts: this.manuscripts } : {}),
      ...(annotations ? { annotations: true } : {}), ...(comments ? { comments: true } : {}),
      ...(membership ? { annotationSources: null } : annotations ? { annotationSources: [...affected] } : {}),
    };
  }
  private set<T>(map: Map<string, T>, path: string, value: T | undefined): void {
    if (value === undefined) map.delete(path); else if (!equal(map.get(path), value)) map.set(path, value);
  }
  annotationsForSource(path: string): ReadonlyMap<string, AnnotationMetadata> {
    if (!this.annotationGroups) {
      this.annotationGroups = new Map();
      for (const a of this.annotations.values()) {
        const target = resolveLinkTarget(a.source, a.path, this.sourceIndex);
        if (!target) continue;
        if (!this.annotationGroups.has(target)) this.annotationGroups.set(target, new Map());
        this.annotationGroups.get(target)!.set(a.path, a);
      }
    }
    return this.annotationGroups.get(path) ?? new Map();
  }
  commentScope(scope?: readonly string[]): ReadonlySet<string> {
    if (!scope) return new Set(this.comments.keys());
    const selected = new Set<string>(), documents = new Set(scope), replies = new Map<string, string[]>();
    const candidates = new PathIndex(this.comments.keys());
    for (const [path, { comment }] of this.comments) {
      const document = resolveLinkTarget(linkPath(comment.document), path, this.recordIndex);
      if (document && documents.has(document)) selected.add(path);
      if (comment.inReplyTo) {
        const root = resolveLinkTarget(linkPath(comment.inReplyTo), path, candidates);
        if (root) { if (!replies.has(root)) replies.set(root, []); replies.get(root)!.push(path); }
      }
    }
    for (const path of selected) for (const reply of replies.get(path) ?? []) selected.add(reply);
    return selected;
  }
}
