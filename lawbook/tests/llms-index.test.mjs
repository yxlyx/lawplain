import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
const root=new URL('../public/',import.meta.url);
test('ruling text directories exactly cover the sitemap snapshot with bounded pages',()=>{
 const maps=readdirSync(new URL('sitemaps/',root)).filter(f=>/^judgments-\d+\.xml$/.test(f));
 const original=maps.flatMap(f=>[...readFileSync(new URL('sitemaps/'+f,root),'utf8').matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]));
 const files=readdirSync(new URL('judgment/index/',root));
 const actual=files.flatMap(f=>{const text=readFileSync(new URL('judgment/index/'+f,root),'utf8');const links=[...text.matchAll(/\]\(<(.*?)\/index\.md>\)/g)].map(m=>m[1]);assert.ok(links.length>0&&links.length<=200);return links;});
 assert.equal(actual.length,new Set(actual).size);
 assert.deepEqual(actual.sort(),original.sort());
 const index=readFileSync(new URL('judgment/llms.txt',root),'utf8');
 for(const f of files)assert.ok(index.includes(`/judgment/index/${f}`));
});
