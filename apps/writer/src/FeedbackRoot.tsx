import { FeedbackProvider, feedbackApplication, resolveFeedbackEndpoint } from "@mdbase-dev/ui/feedback";
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

interface FeedbackContextValue {
  view: "connection" | "manuscripts" | "manuscript";
  collectionName?: string;
}
const connection: FeedbackContextValue = { view: "connection" };
const Context = createContext<(value: FeedbackContextValue) => void>(() => undefined);

/** Application context only: no record paths, manuscript titles or session credentials. */
export function FeedbackRoot({ children }: { children: ReactNode }) {
  const [context, setContext] = useState(connection);
  return <Context.Provider value={setContext}>
    <FeedbackProvider
      endpoint={resolveFeedbackEndpoint(import.meta.env.VITE_MDBASE_FEEDBACK_URL)}
      turnstileSiteKey={import.meta.env.VITE_MDBASE_FEEDBACK_TURNSTILE_SITE_KEY ?? null}
      application={feedbackApplication("mdbase writer", context.view, import.meta.env.VITE_MDBASE_WRITER_BUILD_ID, import.meta.env.VITE_MDBASE_ENV ?? (import.meta.env.DEV ? "development" : "production"))}
      {...(context.collectionName ? { collectionName: context.collectionName } : {})}
    >{children}</FeedbackProvider>
  </Context.Provider>;
}

export function useWriterFeedbackContext(view: "manuscripts" | "manuscript", collectionName: string): void {
  const setContext = useContext(Context);
  useLayoutEffect(() => {
    setContext({ view, collectionName });
    return () => setContext(connection);
  }, [view, collectionName, setContext]);
}
