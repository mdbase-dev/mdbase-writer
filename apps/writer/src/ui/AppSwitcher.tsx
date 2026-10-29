import { useLayoutEffect, useRef } from "react";
import { AppSwitcher as SharedAppSwitcher } from "@mdbase-dev/ui/app-switcher";
import { appUrls } from "../apps.js";

export function AppSwitcher() {
  const host = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    // The pinned UI omits this word boundary; native publishing requires its original bytes.
    const space = document.createTextNode(" ");
    host.current?.querySelector(".wordmark-label > span")?.after(space);
    return () => space.remove();
  }, []);
  return <span ref={host} style={{ display: "contents" }}><SharedAppSwitcher current="writer" urls={appUrls} /></span>;
}
