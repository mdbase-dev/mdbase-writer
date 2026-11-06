import { t } from "@lingui/core/macro";
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, SearchQuery, setSearchQuery } from "@codemirror/search";
import { runScopeHandlers, type EditorView, type Panel } from "@codemirror/view";

export function searchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-search writer-find";
  const field = (name: string, label: string) => {
    const input = document.createElement("input");
    input.name = name;
    input.className = "mdbase-field";
    input.setAttribute("aria-label", label);
    input.placeholder = label;
    return input;
  };
  const find = field("search", t`Find`);
  find.setAttribute("main-field", "true");
  const replacement = field("replace", t`Replace`);
  const button = (name: string, label: string, run: () => void, text = label) => {
    const control = document.createElement("button");
    control.type = "button";
    control.name = name;
    control.className = "mdbase-button is-small";
    control.textContent = text;
    control.setAttribute("aria-label", label);
    control.title = label;
    control.onclick = run;
    return control;
  };
  const options = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = t`Options`;
  options.append(summary);
  const settings = document.createElement("div");
  settings.className = "find-options";
  const flags = [
    { key: "caseSensitive" as const, label: t`Match case` },
    { key: "regexp" as const, label: t`Regular expression` },
    { key: "wholeWord" as const, label: t`Whole words` },
  ].map(({ key, label }) => {
    const control = button(key, label, () => {
      const { test, ...query } = getSearchQuery(view.state);
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...query, ...(test ? { test } : {}), [key]: !query[key] })) });
    });
    settings.append(control);
    return { key, control };
  });
  settings.append(replacement, button("replace", t`Replace`, () => replaceNext(view)), button("replaceAll", t`Replace all`, () => replaceAll(view)));
  options.append(settings);
  dom.append(find, button("prev", t`Previous match`, () => findPrevious(view), "↑"), button("next", t`Next match`, () => findNext(view), "↓"), options, button("close", t`Close Find`, () => { closeSearchPanel(view); view.focus(); }, "×"));
  const sync = () => {
    const query = getSearchQuery(view.state);
    find.value = query.search;
    replacement.value = query.replace;
    find.setAttribute("aria-invalid", String(!query.valid && Boolean(query.search)));
    flags.forEach(({ key, control }) => control.setAttribute("aria-pressed", String(query[key])));
  };
  const change = () => {
    const { test, ...query } = getSearchQuery(view.state);
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...query, ...(test ? { test } : {}), search: find.value, replace: replacement.value })) });
  };
  find.oninput = change;
  replacement.oninput = change;
  dom.onkeydown = event => {
    if (runScopeHandlers(view, event, "search-panel")) event.preventDefault();
    else if (event.key === "Enter" && event.target === find) { event.preventDefault(); (event.shiftKey ? findPrevious : findNext)(view); }
    else if (event.key === "Enter" && event.target === replacement) { event.preventDefault(); replaceNext(view); }
  };
  sync();
  return { dom, top: true, update: sync, mount() { find.select(); } };
}
