// Opt-in V8 snapshot summary. Strong-edge dominators (not a process/RSS measurement).
import { readFileSync } from "node:fs";
const snapshot = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { nodes, edges, strings } = snapshot;
const nf = snapshot.snapshot.meta.node_fields, ef = snapshot.snapshot.meta.edge_fields;
const width = nf.length, ew = ef.length, count = nodes.length / width;
const nt = snapshot.snapshot.meta.node_types[0], et = snapshot.snapshot.meta.edge_types[0];
const name = (i) => strings[nodes[i * width + nf.indexOf("name")]];
const type = (i) => nt[nodes[i * width]];
const size = (i) => nodes[i * width + nf.indexOf("self_size")];
const first = new Uint32Array(count + 1), predCount = new Uint32Array(count);
for (let i = 0; i < count; i++) first[i + 1] = first[i] + nodes[i * width + nf.indexOf("edge_count")] * ew;
const strong = (e) => et[edges[e]] !== "weak";
const target = (e) => edges[e + ef.indexOf("to_node")] / width;
for (let e = 0; e < edges.length; e += ew) if (strong(e)) predCount[target(e)]++;
const pf = new Uint32Array(count + 1);
for (let i = 0; i < count; i++) pf[i + 1] = pf[i] + predCount[i];
const predecessors = new Uint32Array(pf[count]), cursor = pf.slice();
for (let i = 0; i < count; i++) for (let e = first[i]; e < first[i + 1]; e += ew) if (strong(e)) predecessors[cursor[target(e)]++] = i;
const seen = new Uint8Array(count), stack = [0], pending = [first[0]], postorder = [];
seen[0] = 1;
while (stack.length) {
  const i = stack.at(-1); let e = pending.at(-1);
  while (e < first[i + 1] && (!strong(e) || seen[target(e)])) e += ew;
  if (e === first[i + 1]) { postorder.push(i); stack.pop(); pending.pop(); }
  else { pending[pending.length - 1] = e + ew; const child = target(e); seen[child] = 1; stack.push(child); pending.push(first[child]); }
}
const order = postorder.reverse(), rank = new Int32Array(count).fill(-1), dom = new Int32Array(count).fill(-1);
order.forEach((i, r) => rank[i] = r); dom[0] = 0;
const intersect = (a, b) => { while (a !== b) { while (rank[a] > rank[b]) a = dom[a]; while (rank[b] > rank[a]) b = dom[b]; } return a; };
let changed = true, passes = 0;
while (changed) {
  changed = false; passes++;
  for (let r = 1; r < order.length; r++) {
    const i = order[r]; let d = -1;
    for (let p = pf[i]; p < pf[i + 1]; p++) { const parent = predecessors[p]; if (dom[parent] !== -1) d = d === -1 ? parent : intersect(d, parent); }
    if (dom[i] !== d) { dom[i] = d; changed = true; }
  }
}
const retained = new Float64Array(count);
for (let i = 0; i < count; i++) retained[i] = size(i);
for (let r = order.length - 1; r > 0; r--) { const i = order[r]; retained[dom[i]] += retained[i]; }
const self = new Map();
for (let i = 0; i < count; i++) { const key = type(i) === "object" ? `${type(i)}:${name(i)}` : type(i); const g = self.get(key) ?? { bytes: 0, count: 0 }; g.bytes += size(i); g.count++; self.set(key, g); }
const fixtureStrings = new Map(), objects = new Map();
for (let i = 0; i < count; i++) {
  const n = name(i), t = type(i);
  if (t === "string") {
    const category = n.startsWith("> A quotation") ? "annotation bodies" : n.startsWith("Ordinary collection") ? "note bodies"
      : n.startsWith("Source body") ? "source bodies" : n.startsWith("Source metadata.") ? "abstracts"
      : n.startsWith("A comment discussing") ? "comment bodies" : undefined;
    if (category) { const g = fixtureStrings.get(category) ?? { bytes: 0, count: 0 }; g.bytes += size(i); g.count++; fixtureStrings.set(category, g); }
  }
  if (t === "object" && /^(EditorState|ManuscriptAssembler|Citeproc|PathIndex|CollectionStore|ManuscriptWorkspace)$/.test(n)) {
    const g = objects.get(n) ?? { count: 0, maxRetainedBytes: 0 }; g.count++; g.maxRetainedBytes = Math.max(g.maxRetainedBytes, retained[i]); objects.set(n, g);
  }
}
const largest = order.filter((i) => type(i) === "object" || type(i) === "closure").sort((a, b) => retained[b] - retained[a]).slice(0, 50);
console.log(JSON.stringify({ nodes: count, passes, totalBytes: retained[0], fixtureStrings: Object.fromEntries(fixtureStrings), objects: Object.fromEntries(objects), shallow: [...self].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 30),
  dominators: largest.map((i) => ({ id: nodes[i * width + nf.indexOf("id")], name: name(i), type: type(i), retained: retained[i], parent: name(dom[i]), properties: Array.from({ length: (first[i + 1] - first[i]) / ew }, (_, k) => { const e = first[i] + k * ew; return { edge: et[edges[e]] === "element" ? edges[e + 1] : strings[edges[e + 1]], name: name(target(e)), retained: retained[target(e)] }; }).filter((e) => e.retained > 10000).sort((a, b) => b.retained - a.retained).slice(0, 12) })) }, null, 2));
