import { AppSwitcher as SharedAppSwitcher } from "@mdbase-dev/ui/app-switcher";
import { appUrls } from "../apps.js";

export function AppSwitcher() {
  return <SharedAppSwitcher current="writer" urls={appUrls} />;
}
