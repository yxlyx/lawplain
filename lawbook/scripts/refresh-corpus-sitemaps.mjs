/** Refresh public URL discovery after a corpus ingest. Read-only D1 queries.
 * Usage: npm run seo:refresh-sitemaps -- /path/to/sglaw/d1-worker/wrangler.jsonc
 * Uses the operator's existing Wrangler authentication. Never exports bodies.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = process.argv[2] || process.env.LAWPLAIN_CORPUS_WRANGLER_CONFIG;
if (!config) throw new Error('Pass the sgjudge Wrangler config path.');
const site = 'https://lawplain.com';
const resources = [
 ['judgments','citation','/judgment/'], ['statutes','act_id','/statute/'],
 ['hansard_speeches','speech_id','/document/hansard/'],
 ['bills','bill_id','/document/bills/'],
 ['subsidiary_legislation','sl_id','/document/subsidiary/'],
 ['practice_directions','pd_id','/document/practice/'],
 ['agency_guidance','guidance_id','/document/guidance/'],
];
const escape = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const staging = resolve(root,'public/.sitemaps-staging');
mkdirSync(staging,{recursive:true});
const maps = [], counts = {};
try {
for (const [table,key,prefix] of resources) {
 let cursor = '', part = 0, total = 0;
 for (;;) {
  const sql = `SELECT DISTINCT ${key} AS id FROM ${table} WHERE ${key} > '${cursor.replace(/'/g,"''")}' ORDER BY ${key} LIMIT 5000`;
  const output = execFileSync(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','sgjudge','--config',resolve(config),'--remote','--command',sql,'--json'],{encoding:'utf8',maxBuffer:8*1024*1024});
  const result = JSON.parse(output);
  if (!result[0]?.success) throw new Error(`D1 query failed for ${table}`);
  const rows = result[0].results;
  if (!rows.length) break;
  const urls = rows.map(row=>{if(typeof row.id!=='string'||!row.id)throw new Error('Invalid corpus identifier');return site+prefix+encodeURIComponent(row.id)});
  const filename = `${table}-${part++}.xml`;
  writeFileSync(resolve(staging,filename),'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+urls.map(url=>`<url><loc>${escape(url)}</loc></url>`).join('\n')+'\n</urlset>\n');
  maps.push('/sitemaps/'+filename);
  total+=rows.length;cursor=rows.at(-1).id;
  if(rows.length<5000)break;
 }
 counts[table]=total;console.log(`${table}: ${total} canonical document URLs`);
}
const index = '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+maps.map(path=>`<sitemap><loc>${site}${path}</loc></sitemap>`).join('\n')+'\n</sitemapindex>\n';
const destination = resolve(root,'public/sitemaps');
rmSync(destination,{recursive:true,force:true});renameSync(staging,destination);
writeFileSync(resolve(root,'public/corpus-sitemap.xml'),index);
writeFileSync(resolve(root,'docs/design/corpus-sitemap-snapshot.json'),JSON.stringify({generatedAt:new Date().toISOString(),counts,sitemaps:maps.length,total:Object.values(counts).reduce((a,b)=>a+b,0)},null,2)+'\n');
} catch(e) {rmSync(staging,{recursive:true,force:true});throw e;}

await import('./generate-llms-index.mjs');
