import type { ReactNode } from "react";
import { MdbaseAppMark } from "@mdbase-dev/ui/brand";
import { CollectionGate, CollectionSwitcher, type CollectionAppIdentity } from "@mdbase-dev/ui/collections";
import type { Mdbase, MdbaseApplicationConnection } from "@mdbase-dev/sdk";
import manifest from "../generated/mdbase-app.json";
import { InTopbar } from "./topbar.js";
import "@mdbase-dev/ui/collections.css";
import "./writer-collections.css";

/** Writer's identity in the shared collection screens. */
const writerApp: CollectionAppIdentity = {name: manifest.name, mark: <MdbaseAppMark app="writer" />};

/** The shared gate: sign-in, choosing, approval, setup and problems. */
export function WriterCollectionGate({mdbase, children}: {mdbase: Mdbase; children(connection: MdbaseApplicationConnection): ReactNode}) {
  return <CollectionGate mdbase={mdbase} app={writerApp}>{children}</CollectionGate>;
}

/** The shared switcher in the top bar. It is hidden while a manuscript is open,
 * where the bar belongs to the manuscript and leaving goes through its own save guard. */
export function WriterCollectionSwitcher({mdbase}: {mdbase: Mdbase}) {
  return <InTopbar><CollectionSwitcher mdbase={mdbase} app={writerApp} variant="full" className="writer-collection-switcher" /></InTopbar>;
}
