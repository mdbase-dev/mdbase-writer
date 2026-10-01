// Typst produces positioned HTML for its own rendered text. Strip active content
// and unsafe links before adding it to the selectable/accessibility layer.
export function semanticLayer(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script, style, iframe, object, embed, form, input, button, meta, link, img, svg").forEach((element) => element.remove());
  for (const element of template.content.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || ["src", "srcdoc"].includes(attribute.name)) element.removeAttribute(attribute.name);
      if (attribute.name === "href" && !/^(https?:|mailto:|#)/i.test(attribute.value)) element.removeAttribute("href");
    }
    if (element instanceof HTMLAnchorElement) { element.rel = "noopener noreferrer"; element.target = "_blank"; }
  }
  return template.content;
}
