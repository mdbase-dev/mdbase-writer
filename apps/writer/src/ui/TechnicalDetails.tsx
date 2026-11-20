import { Trans } from "@lingui/react/macro";

export function TechnicalDetails({details}: {details: string}) {
  return <details><summary><Trans>Technical details</Trans></summary><code>{details}</code></details>;
}
