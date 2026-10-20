import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const workflow = await readFile(new URL('../.github/workflows/deploy-writer.yml', import.meta.url), 'utf8');
const native = workflow.slice(workflow.indexOf('  native-dispatch:'));
test('native credentials never share the frozen app install/build job', () => {
  const build = native.split('  native-build:')[1]?.split('  native-deploy:')[0];
  assert.ok(build, 'separate native-build required');
  assert.doesNotMatch(build, /environment:|secrets\.|CLOUDFLARE_API_TOKEN/);
  const upload = native.split('  native-deploy:')[1];
  assert.doesNotMatch(upload, /pnpm (?:check|build|dlx)|pnpm install --frozen-lockfile\n|functions build/);
  assert.match(upload, /NPM_CONFIG_USERCONFIG=\/dev\/null NPM_CONFIG_GLOBALCONFIG=\/dev\/null pnpm --ignore-workspace install --frozen-lockfile --ignore-scripts --ignore-pnpmfile/);
  assert.match(upload, /cp tools\/native-publisher/);
  assert.match(upload, /--no-bundle/);
  assert.ok(upload.indexOf('node scripts/native-current-head.mjs') < upload.indexOf('pages deploy artifact/publish'));
});
test('four protected original byte expectations replace descriptor authority', () => {
  assert.doesNotMatch(native, /WRITER_NATIVE_TRUST_SHA256/);
  for (const name of ['NATIVE_SDK_SHA256','NATIVE_UI_SHA256','NATIVE_PROTOCOL_SHA256','NATIVE_TRUST_ASSET_SHA256']) assert.match(native, new RegExp(`vars\\.${name}`));
});
test('only protected artifact transport receives Actions read permission', () => {
  const build = native.split('  native-build:')[1].split('  native-deploy:')[0];
  const upload = native.split('  native-deploy:')[1];
  assert.match(upload, /^    permissions:\n      contents: read\n      actions: read$/m);
  assert.doesNotMatch(build, /actions: read/);
});
test('served checks require successful actual deployment UUID capture', () => {
  const upload = native.split('  native-deploy:')[1];
  const capture = upload.split('      - name: Capture actual UUID before any served checks')[1].split('      - name: All served bytes')[0];
  const verification = upload.split('      - name: All served bytes')[1].split('      - name: Failure receipt')[0];
  assert.match(capture, /^        id: deployment$/m);
  assert.match(verification, /if: always\(\) && steps\.upload\.outcome == 'success' && steps\.deployment\.outcome == 'success'/);
  assert.match(upload, /name: Failure receipt[^\n]*\n        if: always\(\)/);
});
test('shared byte helper is exact reviewed bytes', async () => {
  const { createHash } = await import('node:crypto');
  const helper = await readFile(new URL('../scripts/lib/native-publish-bytes.mjs', import.meta.url));
  assert.equal(createHash('sha256').update(helper).digest('hex'), 'a4336258cea726285573e9e667bba1c1ad6797fdba331715d0f17ea67ea5c66a');
});
