// System / Light / Dark, shared with other mdbase apps as `mdbase:theme`.
export type ThemePreference = "system" | "light" | "dark";
const KEY = "mdbase:theme";

export function loadTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(preference: ThemePreference): void {
  if (preference === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset["theme"] = preference;
  try {
    localStorage.setItem(KEY, preference);
  } catch {
    // Storage may be unavailable (private windows); the choice lasts for this page.
  }
}
