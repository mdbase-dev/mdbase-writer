// Where each build of mdbase writer is deployed, and which Connect it uses.
// Lab, staging and production mirror mdbase Reader's targets.
export const writerDeployments = Object.freeze({
  lab: Object.freeze({
    origin: "https://lab.mdbase-writer.pages.dev",
    connectUrl: "https://connect-lab.mdbase.dev",
    loopbackUrl: "http://127.0.0.1:28487",
    branch: "lab",
    // Lab is a test deployment: it also serves the in-memory demo (?demo).
    demo: true,
  }),
  staging: Object.freeze({
    origin: "https://staging.mdbase-writer.pages.dev",
    connectUrl: "https://connect-staging.mdbase.dev",
    loopbackUrl: "http://127.0.0.1:28486",
    branch: "staging",
    demo: false,
  }),
  production: Object.freeze({
    origin: "https://writer.mdbase.dev",
    connectUrl: "https://connect.mdbase.dev",
    loopbackUrl: "http://127.0.0.1:28485",
    branch: "main",
    demo: false,
  }),
});

export const pagesProject = "mdbase-writer";
export const assetsBucket = "mdbase-writer-assets";

export function writerDeploymentFor(environment) {
  if (environment.MDBASE_ENV && environment.MDBASE_WRITER_DEPLOY_TARGET && environment.MDBASE_ENV !== environment.MDBASE_WRITER_DEPLOY_TARGET) {
    throw new Error("Conflicting writer deployment targets; refusing to deploy.");
  }
  const target = environment.MDBASE_ENV ?? environment.MDBASE_WRITER_DEPLOY_TARGET ?? "lab";
  const deployment = writerDeployments[target];
  if (!deployment) throw new Error(`Unsupported writer deployment target: ${target}.`);
  if (environment.MDBASE_CONNECT_URL && environment.MDBASE_CONNECT_URL !== deployment.connectUrl) {
    throw new Error(`${target} writer requires ${deployment.connectUrl}, received ${environment.MDBASE_CONNECT_URL}.`);
  }
  return { target, deployment };
}

/**
 * Staging and production must be reproducible from a commit. Returns the
 * uncommitted paths that would reach the build, from `git status --porcelain`
 * output; untracked files outside the workspace sources (screenshots, scratch
 * output) cannot and are ignored.
 */
export function uncommittedBuildInputs(porcelain) {
  return porcelain
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [, status = "", path = ""] = /^\s*(\S{1,2})\s+(.*)$/u.exec(line) ?? [];
      return status !== "??" || /^(apps|packages)\//u.test(path) ? [path] : [];
    });
}

export function assertReproducibleDeployment(target, porcelain, environment) {
  if (target === "lab" || environment.MDBASE_WRITER_ALLOW_DIRTY === "1") return;
  const paths = uncommittedBuildInputs(porcelain);
  if (paths.length > 0) {
    throw new Error(
      `Refusing to deploy ${target} with uncommitted changes (${paths.slice(0, 5).join(", ")}${paths.length > 5 ? ", …" : ""}). Commit them, or set MDBASE_WRITER_ALLOW_DIRTY=1 to override.`,
    );
  }
}
