// Pandoc returns informational resource-load messages alongside real warnings.
export function pandocWarnings(messages: readonly unknown[]): string[] {
  return messages.flatMap((message) => {
    if (typeof message === "string") return [message];
    if (!message || typeof message !== "object") return [];
    const value = message as { verbosity?: string; pretty?: string; message?: string; type?: string };
    if (value.verbosity === "INFO" || value.verbosity === "DEBUG") return [];
    return [value.pretty ?? value.message ?? value.type ?? "Pandoc reported an export problem."];
  });
}
