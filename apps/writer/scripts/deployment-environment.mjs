// Where each build of mdbase writer is deployed, and which Connect it uses.
// Only lab exists so far; staging and production are added when they do.
export const writerDeployments = Object.freeze({
  lab: Object.freeze({
    origin: "https://lab.mdbase-writer.pages.dev",
    connectUrl: "https://connect-lab.mdbase.dev",
    loopbackUrl: "http://127.0.0.1:28487",
    branch: "lab",
    // Lab is a test deployment: it also serves the in-memory demo (?demo).
    demo: true,
  }),
});

export const pagesProject = "mdbase-writer";
export const assetsBucket = "mdbase-writer-assets";

export function writerDeploymentFor(environment) {
  const target = environment.MDBASE_ENV ?? "lab";
  const deployment = writerDeployments[target];
  if (!deployment) throw new Error(`Unsupported writer deployment target: ${target}.`);
  return { target, deployment };
}
