// Like TaskNotes, retain the real staging package/lock for historical publisher tests.
// Today's production dependency must not be relabeled as a staging SDK.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function frozenStagingRoot(t, { installed = false } = {}) {
 const source=resolve('.');
 await mkdir(join(source,'test-results'),{recursive:true});
 const root=await realpath(await mkdtemp(join(source,'test-results/staging-inputs-')));
 t.after(()=>rm(root,{recursive:true,force:true}));
 for(const [file,snapshot] of [['apps/writer/package.json','staging-package.snapshot'],['pnpm-lock.yaml','staging-lock.snapshot']]){
  await mkdir(join(root,file,'..'),{recursive:true});
  await writeFile(join(root,file),await readFile(new URL(`./fixtures/${snapshot}`,import.meta.url)));
 }
 for(const path of ['config/native-publish/staging.json','apps/writer/vendor/native-release/staging']){
  await mkdir(join(root,path,'..'),{recursive:true});
  await cp(join(source,path),join(root,path),{recursive:true});
 }
 const pkg=JSON.parse(await readFile(join(root,'apps/writer/package.json')));
 for(const name of ['sdk','ui','connect-protocol']){
  const path=resolve(root,'apps/writer',pkg.dependencies[`@mdbase-dev/${name}`].slice(5));
  await mkdir(join(path,'..'),{recursive:true});
  await cp(join(source,path.slice(root.length+1)),path);
  if(installed){
   const destination=join(root,'apps/writer/node_modules/@mdbase-dev',name);
   await mkdir(destination,{recursive:true});
   execFileSync('tar',['-xzf',path,'-C',destination,'--strip-components=1']);
  }
 }
 return root;
}
