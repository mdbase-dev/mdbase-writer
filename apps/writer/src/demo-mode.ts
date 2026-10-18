/** Explicit development/test fixtures only. A demo query alone never bypasses
 * the native entry in ordinary deployment builds. */
export function writerDemoRequested(): boolean {
  return (import.meta.env.DEV || import.meta.env.VITE_WRITER_DEMO === "1")
    && new URL(location.href).searchParams.has("demo");
}
