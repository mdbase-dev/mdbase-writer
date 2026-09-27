// Citation styles bundled with the writer (CSL files under assets/csl).
export const STYLES = [
  { id: "chicago-notes-bibliography", title: "Chicago (notes and bibliography)" },
  { id: "chicago-author-date", title: "Chicago (author-date)" },
  { id: "apa", title: "APA 7th edition" },
  { id: "modern-language-association", title: "MLA 9th edition" },
  { id: "harvard-cite-them-right", title: "Harvard (Cite Them Right)" },
  { id: "ieee", title: "IEEE" },
] as const;
export type StyleId = (typeof STYLES)[number]["id"];
