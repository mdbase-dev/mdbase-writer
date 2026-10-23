import { t } from "@lingui/core/macro";
// Pandoc returns informational resource-load messages alongside real warnings.
export function pandocWarnings(messages: readonly unknown[]): string[] {
  return messages.flatMap((message) => {
    if (typeof message === "string") return [exportWarningMessage(message)];
    if (!message || typeof message !== "object") return [];
    const value = message as { verbosity?: string; pretty?: string; message?: string; type?: string };
    if (value.verbosity === "INFO" || value.verbosity === "DEBUG") return [];
    return [exportWarningMessage(value.pretty ?? value.message ?? value.type ?? t`Word export reported a problem.`)];
  });
}

function exportWarningMessage(message: string): string {
  const missingImage = /^Could not fetch resource (.+): replacing image with description\.?$/.exec(message);
  return missingImage
    ? t`The image “${missingImage[1]}” could not be loaded for Word. Its description will be included instead.`
    : message;
}
