import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const root=new URL('../public/sitemaps/',import.meta.url);
test('corpus sitemaps contain unique canonical public document URLs in bounded shards',()=>{
 const seen=new Set();
 const index=readFileSync(new URL('../public/corpus-sitemap.xml',import.meta.url),'utf8');
 const manifest=JSON.parse(readFileSync(new URL('../docs/design/corpus-sitemap-snapshot.json',import.meta.url),'utf8'));
 const files=readdirSync(root).filter(x=>x.endsWith('.xml'));
 assert.equal(files.length,manifest.sitemaps);
 for(const file of files){
  assert.ok(index.includes(`https://lawplain.com/sitemaps/${file}`));
  const xml=readFileSync(new URL(file,root),'utf8');
  assert.ok(xml.startsWith('<?xml'));
  const urls=[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x=>x[1]);
  assert.ok(urls.length>0&&urls.length<=5000);
  for(const url of urls){
   const u=new URL(url);
   assert.equal(u.origin,'https://lawplain.com');
   assert.match(u.pathname,/^\/(judgment|statute|document)\//);
   assert.equal(u.search,'');assert.equal(u.hash,'');
   assert.ok(!seen.has(url),`duplicate: ${url}`);seen.add(url);
  }
 }
 assert.equal(seen.size,manifest.total);
});
