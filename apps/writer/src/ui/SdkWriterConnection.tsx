import {
  describeError,
  type MdbaseApplication,
  type MdbaseApplicationSnapshot,
  type MdbaseErrorDescription,
} from "@mdbase-dev/sdk";
import { ConnectLayout } from "@mdbase-dev/ui/screens";

type Run = (signal: AbortSignal) => Promise<unknown>;
type Recovery =
  | { readonly label: string; readonly run: Run }
  | { readonly label: string; readonly href: string }
  | { readonly label: string; readonly reload: true };
interface Props {
  readonly application: MdbaseApplication;
  readonly snapshot: MdbaseApplicationSnapshot;
  readonly problem: MdbaseErrorDescription | null;
  readonly working: boolean;
  readonly act: (action: Run) => Promise<void>;
  readonly onSignedOut: (() => void) | undefined;
  readonly requestSetup: () => void;
}

/** Presentation only. Registration, readiness, setup and recovery stay in the SDK. */
function stateOf(
  snapshot: MdbaseApplicationSnapshot,
  actionProblem: MdbaseErrorDescription | null,
) {
  const closed = snapshot.status === "closed";
  const waiting =
    snapshot.status === "authorizing" ||
    snapshot.selection.state === "approving";
  const opening =
    snapshot.readiness.checking ||
    ["starting", "opening"].includes(snapshot.status) ||
    snapshot.selection.state === "opening";
  const settled = !closed && !waiting && !opening;
  const readinessProblem =
    settled &&
    (snapshot.readiness.problem !== null ||
      snapshot.readiness.assessment?.problem != null);
  const assessment = snapshot.readiness.assessment;
  const retired =
    settled &&
    snapshot.status === "ready" &&
    !readinessProblem &&
    assessment?.status === "ready";
  const unchecked =
    settled &&
    snapshot.status === "ready" &&
    !readinessProblem &&
    assessment === null;
  // Do not describe a cached assessment as a settled failure while a new check runs.
  const described =
    actionProblem ??
    (settled
      ? (describeError(snapshot) ??
        (snapshot.status === "blocked" ? describeError("open_failed") : null))
      : null);
  const unavailable = snapshot.problem === "application_not_yet_available";
  const invalid = snapshot.selection.state === "invalid";
  const approval = snapshot.selection.state === "approval_required";
  const setup =
    settled &&
    (snapshot.status === "setup_required" ||
      assessment?.status === "setup_required");
  return {
    closed,
    waiting,
    opening,
    settled,
    readinessProblem,
    retired,
    unchecked,
    described,
    unavailable,
    invalid,
    approval,
    setup,
  };
}

function recoveryFor(
  application: MdbaseApplication,
  snapshot: MdbaseApplicationSnapshot,
  state: ReturnType<typeof stateOf>,
  requestSetup: () => void,
): Recovery | null {
  if (state.closed) return { label: "Reload", reload: true };
  if (state.retired)
    return {
      label: "Choose another collection",
      run: (signal) => application.chooseAnother({ signal }),
    };
  if (state.unchecked)
    return {
      label: "Check again",
      run: (signal) => application.assess({ signal }),
    };
  const description = state.described;
  if (!description) return null;
  const label = description.actionLabel ?? "Try again";
  switch (description.action) {
    case "sign_in":
      return { label, run: (signal) => application.authorize({ signal }) };
    case "approve":
      return {
        label,
        run: (signal) =>
          snapshot.status === "blocked"
            ? application.reauthorize({ signal })
            : application.approve(snapshot.selection.requested.collectionId, {
                signal,
              }),
      };
    case "choose_collection":
      return { label, run: (signal) => application.chooseAnother({ signal }) };
    case "set_up":
      return {
        label,
        run: (signal) => {
          signal.throwIfAborted();
          requestSetup();
          return Promise.resolve();
        },
      };
    case "update_app":
      return description.updateUrl
        ? { label, href: description.updateUrl }
        : { label, reload: true };
    case "retry":
    case "check_connection":
    case "reload":
      if (state.readinessProblem && snapshot.status !== "blocked")
        return {
          label: "Check again",
          run: (signal) => application.assess({ signal }),
        };
      return description.action === "reload"
        ? { label, reload: true }
        : { label, run: (signal) => application.start({ signal }) };
    // Resume the SDK's original journal, never submit a fresh configure/approval.
    case "resolve_outcome":
      return { label, run: (signal) => application.start({ signal }) };
    default:
      return null;
  }
}

function messageFor(
  snapshot: MdbaseApplicationSnapshot,
  state: ReturnType<typeof stateOf>,
  signedIn: boolean,
): string {
  const selected = snapshot.collections.find(
    (collection) => collection.collectionId === snapshot.selectedCollectionId,
  );
  const candidates = [
    [state.closed, "Writer has signed out. Reload to sign in again."],
    [state.described !== null, state.described?.message ?? ""],
    [state.waiting, "Waiting for approval in the mdbase tab…"],
    [
      state.retired,
      "The connection to this collection has changed. Choose the collection again.",
    ],
    [
      state.unchecked,
      "This collection hasn't been checked yet. Check again before writing.",
    ],
    [state.opening, `Opening ${selected?.displayName ?? "your collection"}…`],
    [state.setup, "This collection needs Writer setup before writing."],
    [
      state.approval,
      "This collection needs your approval before Writer can open it.",
    ],
    [signedIn, "Choose a collection to start writing."],
  ] as const;
  return (
    candidates.find(([applies]) => applies)?.[1] ??
    "Sign in with your mdbase account to sync mdbase writer across your devices."
  );
}

function identityOf(
  signIn: MdbaseApplicationSnapshot["signIn"],
): string | null {
  if (signIn?.accountEmail) return `Signed in as ${signIn.accountEmail}`;
  return signIn?.accountProvider === "github" && signIn.accountLogin
    ? `Signed in as ${signIn.accountLogin} on GitHub`
    : null;
}

export function SdkWriterConnection(props: Props) {
  const { application, snapshot, problem, working, act } = props;
  const state = stateOf(snapshot, problem);
  const recovery = recoveryFor(
    application,
    snapshot,
    state,
    props.requestSetup,
  );
  const signIn =
    !state.closed && snapshot.signIn?.state === "paired"
      ? snapshot.signIn
      : null;
  const identity = identityOf(signIn);
  const error = [
    problem !== null,
    snapshot.status === "blocked",
    state.invalid,
    state.readinessProblem,
    state.retired,
    state.described?.severity === "error",
  ].includes(true);
  const choose =
    !state.closed &&
    !!(
      snapshot.selectedCollectionId ||
      snapshot.selection.requested.collectionId ||
      state.invalid
    );
  return (
    <ConnectLayout
      app="writer"
      title={state.described?.title ?? "Write from your collection"}
    >
      {identity ? <p>{identity}</p> : null}
      <p role={error ? "alert" : "status"} aria-live="polite">
        {messageFor(snapshot, state, signIn !== null)}
      </p>
      <div className="native-signin-actions">
        {recovery ? (
          <RecoveryControl recovery={recovery} working={working} act={act} />
        ) : null}
        <OrdinaryActions
          {...props}
          state={state}
          recovery={recovery}
          signedIn={signIn !== null}
        />
        {choose &&
        !state.retired &&
        state.described?.action !== "choose_collection" ? (
          <button
            type="button"
            className="mdbase-button"
            disabled={working}
            onClick={() =>
              void act((signal) => application.chooseAnother({ signal }))
            }
          >
            Choose another collection
          </button>
        ) : null}
      </div>
    </ConnectLayout>
  );
}

function OrdinaryActions({
  application,
  snapshot,
  working,
  act,
  onSignedOut,
  requestSetup,
  state,
  recovery,
  signedIn,
}: Props & {
  readonly state: ReturnType<typeof stateOf>;
  readonly recovery: Recovery | null;
  readonly signedIn: boolean;
}) {
  const choosing =
    state.settled && !state.unavailable && !state.invalid && !state.approval;
  const requested = snapshot.selection.requested.collectionId;
  return (
    <>
      {state.settled &&
      !state.unavailable &&
      !state.invalid &&
      !recovery &&
      !state.described ? (
        <button
          type="button"
          className="mdbase-button is-primary"
          disabled={working}
          onClick={() =>
            void act((signal) => application.approve(requested, { signal }))
          }
        >
          {requested
            ? "Approve collection"
            : signedIn
              ? "Add a collection"
              : "Sign in"}
        </button>
      ) : null}
      {signedIn ? (
        <button
          type="button"
          className="mdbase-button"
          disabled={working}
          onClick={() =>
            void act(async (signal) => {
              await application.close();
              signal.throwIfAborted();
              onSignedOut?.();
            })
          }
        >
          Sign out
        </button>
      ) : null}
      {state.setup && !recovery ? (
        <button
          type="button"
          className="mdbase-button is-primary"
          disabled={working}
          onClick={requestSetup}
        >
          {describeError("setup_required")?.actionLabel}
        </button>
      ) : null}
      {snapshot.selectedCollectionId && !state.closed ? (
        <button
          type="button"
          className="mdbase-button"
          disabled={working}
          onClick={() => {
            const id = snapshot.selectedCollectionId;
            if (id) void act((signal) => application.forget(id, { signal }));
          }}
        >
          Forget collection
        </button>
      ) : null}
      {choosing
        ? snapshot.collections.map((collection) => (
            <button
              key={collection.collectionId}
              type="button"
              className="mdbase-button"
              disabled={working}
              onClick={() =>
                void act((signal) =>
                  application.select(collection.collectionId, { signal }),
                )
              }
            >
              {collection.displayName}
            </button>
          ))
        : null}
    </>
  );
}

function RecoveryControl({
  recovery,
  working,
  act,
}: {
  readonly recovery: Recovery;
  readonly working: boolean;
  readonly act: Props["act"];
}) {
  const className = "mdbase-button is-primary";
  if ("href" in recovery)
    return (
      <a className={className} href={recovery.href}>
        {recovery.label}
      </a>
    );
  return (
    <button
      type="button"
      className={className}
      disabled={working}
      onClick={() =>
        "reload" in recovery ? window.location.reload() : void act(recovery.run)
      }
    >
      {recovery.label}
    </button>
  );
}
