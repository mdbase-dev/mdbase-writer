import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
it("Native callback leaves SAME popup lifetime to original SDK finish and custody ACK",()=>{
  const source=readFileSync(new URL("./main.tsx",import.meta.url),"utf8");
  expect(source).not.toMatch(/finally\(\(\)\s*=>\s*window\.close\(\)\)/);
});
