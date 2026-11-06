import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
test('immutable Writer builds retain both target public feedback inputs',async()=>{
 const workflow=await readFile('.github/workflows/deploy-writer.yml','utf8');
 for(const value of ['https://feedback-api.mdbase.dev/v1/feedback','https://feedback-api-staging.mdbase.dev/v1/feedback','VITE_MDBASE_TURNSTILE_SITE_KEY'])assert.ok(workflow.includes(value));
});
