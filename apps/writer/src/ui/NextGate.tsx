// Before and around an mdbase-next collection: connecting, waiting for one of
// the person's devices, connection problems, and a sync status line.
import { ConnectLayout, OpeningScreen } from "@mdbase-dev/ui/screens";
import { FeedbackButton } from "@mdbase-dev/ui/feedback";
import { useEffect, useState } from "react";

import type { NextBackend, NextSync } from "../backend/next.js";
import type { NextProblem, NextRecovery } from "../backend/next-errors.js";
import { nextStatusText } from "./next-status.js";

const ACTION: Partial<Record<NextRecovery, string>> = {
  reconnect: "Connect again",
  upgrade: "Reload Writer",
  wait: "Try again now",
  refresh: "Reload",
  report: "Reload",
};

export function NextGate({ waiting, problem }: { waiting?: NextProblem | undefined; problem?: NextProblem | undefined }) {
  if (problem && !problem.waitingForDevice) {
    const action = ACTION[problem.recovery];
    return (
      <ConnectLayout app="writer" title="The collection could not be opened">
        <p className="problem" role="alert">{problem.message}</p>
        {action && <button className="mdbase-button" type="button" onClick={() => location.reload()}>{action}</button>}
        <FeedbackButton />
      </ConnectLayout>
    );
  }
  if (waiting || problem?.waitingForDevice) {
    return (
      <OpeningScreen app="writer" title="Waiting for one of your devices"
        detail="This collection is kept on your own devices. Open mdbase on one of them and Writer will connect." />
    );
  }
  return <OpeningScreen app="writer" title="Opening mdbase writer" detail="Connecting to your collection" />;
}

export function NextStatus({ backend }: { backend: NextBackend }) {
  const [sync, setSync] = useState<NextSync | null>(null);
  useEffect(() => backend.onSync(setSync), [backend]);
  const text = sync && nextStatusText(sync);
  if (!text) return null;
  return <div className="banner" role={sync?.link === "closed" ? "alert" : "status"}><span>{text}</span></div>;
}
