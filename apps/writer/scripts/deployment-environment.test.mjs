import assert from "node:assert/strict";
import test from "node:test";

import { assertReproducibleDeployment, uncommittedBuildInputs, writerAppUrlsFor, writerDeploymentFor, writerDeployments } from "./deployment-environment.mjs";

test("deploys target lab by default, which alone serves the demo", () => {
  assert.deepEqual(writerDeploymentFor({}), { target: "lab", deployment: writerDeployments.lab });
  assert.equal(writerDeployments.lab.demo, true);
  assert.equal(writerDeployments.staging.demo, false);
  assert.equal(writerDeployments.production.demo, false);
});

test("each environment binds every sibling app and rejects missing or foreign URLs", () => {
  for (const target of Object.keys(writerDeployments)) {
    const urls = writerAppUrlsFor(target);
    assert.equal(urls.writer, writerDeployments[target].origin);
    assert.equal(urls.editor, writerDeployments[target].editorUrl);
    assert.equal(urls.reader, writerDeployments[target].readerUrl);
    for (const app of Object.keys(urls)) {
      const key = `VITE_MDBASE_${app.toUpperCase()}_URL`;
      assert.throws(() => writerAppUrlsFor(target, { [key]: "" }), /missing or foreign/);
      assert.throws(() => writerAppUrlsFor(target, { [key]: "https://foreign.example" }), /missing or foreign/);
    }
  }
});

test("staging and production are explicit, and production uses the custom domain", () => {
  assert.equal(writerDeploymentFor({ MDBASE_ENV: "staging" }).deployment, writerDeployments.staging);
  const { deployment } = writerDeploymentFor({ MDBASE_WRITER_DEPLOY_TARGET: "production" });
  assert.equal(deployment.origin, "https://writer.mdbase.dev");
  assert.equal(deployment.connectUrl, "https://connect.mdbase.dev");
  assert.equal(deployment.branch, "main");
  assert.equal(writerDeployments.staging.branch, "staging");
  assert.equal(writerDeployments.staging.connectUrl, "https://connect-staging.mdbase.dev");
});

test("every target has an exact HTTPS app and Connect origin", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(writerDeployments).map(([name, d]) => [name, [d.origin, d.connectUrl]])),
    {
      lab: ["https://lab.mdbase-writer.pages.dev", "https://connect-lab.mdbase.dev"],
      staging: ["https://staging.mdbase-writer.pages.dev", "https://connect-staging.mdbase.dev"],
      production: ["https://writer.mdbase.dev", "https://connect.mdbase.dev"],
    },
  );
});

test("refuses conflicting selectors, unknown targets and mismatched Connect origins", () => {
  assert.throws(() => writerDeploymentFor({ MDBASE_ENV: "staging", MDBASE_WRITER_DEPLOY_TARGET: "production" }), /Conflicting/);
  assert.throws(() => writerDeploymentFor({ MDBASE_ENV: "unknown" }), /Unsupported/);
  assert.throws(() => writerDeploymentFor({ MDBASE_ENV: "lab", MDBASE_CONNECT_URL: "https://connect.mdbase.dev" }), /lab writer requires/);
});

test("refuses staging and production deploys that are not reproducible from a commit", () => {
  const status = " M apps/writer/src/App.tsx\n?? packages/core/src/new.ts\n?? screenshot.png\n";
  assert.deepEqual(uncommittedBuildInputs(status), ["apps/writer/src/App.tsx", "packages/core/src/new.ts"]);
  assert.throws(() => assertReproducibleDeployment("production", status, {}), /uncommitted/u);
  assert.throws(() => assertReproducibleDeployment("staging", status, {}), /uncommitted/u);
  assert.doesNotThrow(() => assertReproducibleDeployment("lab", status, {}));
  assert.doesNotThrow(() => assertReproducibleDeployment("production", "?? screenshot.png\n", {}));
  assert.doesNotThrow(() => assertReproducibleDeployment("production", status, { MDBASE_WRITER_ALLOW_DIRTY: "1" }));
});
