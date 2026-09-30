// Browser-test fixture: no Connect daemon, authorization, or collection writes.
import { createRoot } from "react-dom/client";
import { CollectionPicker } from "../src/ui/CollectionPicker.js";

export function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const calls: unknown[] = [];
  const state = { calls, fail: false, finish: () => {} };
  const root = createRoot(host);
  root.render(<CollectionPicker name="Current" collectionId="current" connections={[
    { collectionId: "current", displayName: "Cached name", authority: { kind: "hosted" } },
    { collectionId: "other", displayName: "Other", authority: { kind: "connector" } },
  ] as never} session={{
    select: (id: string) => {
      calls.push(["select", id]);
      return state.fail ? { ok: false, problem: { message: "Selection failed" } } : { ok: true };
    },
    authorize: (target: string, options: unknown) => {
      calls.push(["authorize", target, options]);
      return new Promise((resolve) => {
        state.finish = () => resolve({ ok: false, problem: { message: "Authorization cancelled" } });
      });
    },
  } as never} />);
  return state;
}
