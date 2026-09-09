/** Build machine-readable ruling discovery from the verified sitemap snapshot. */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root,'public/judgment');
mkdirSync(directory,{recursive:true});
const pages = resolve(directory,'index');
rmSync(pages,{recursive:true,force:true});
mkdirSync(pages,{recursive:true});
const urls = readdirSync(resolve(root,'public/sitemaps')).filter(f=>/^judgments-\d+\.xml$/.test(f)).sort().flatMap(f=>[...readFileSync(resolve(root,'public/sitemaps',f),'utf8').matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]));
const unique = [...new Set(urls)].sort();
const links=[];
for (let i=0;i<unique.length;i+=200) {
 const batch=unique.slice(i,i+200), part=i/200+1;
 const content=`# Lawplain rulings — directory ${part}\n\n> Links to source judgment text. Follow continuation links for long rulings.\n\n## Rulings\n\n`+batch.map(url=>`- [${decodeURIComponent(url.split('/').at(-1)).replace(/[\[\]]/g,'')}](<${url}/index.md>)`).join('\n')+'\n';
 writeFileSync(resolve(pages,`${part}.md`),content);
 links.push(`- [Rulings ${i+1}–${Math.min(i+200,unique.length)}](https://lawplain.com/judgment/index/${part}.md)`);
}
writeFileSync(resolve(directory,'llms.txt'),`# Lawplain judgment directory\n\n> ${unique.length.toLocaleString('en')} public ruling identifiers from the corpus sitemap snapshot. Each directory links to original ruling text in Markdown.\n\nThis directory is regenerated with the corpus sitemaps. Coverage is not exhaustive of all Singapore decisions. Long documents have explicit text ranges and continuation links.\n\n## Ruling directories\n\n${links.join('\n')}\n`);
console.log(`Indexed ${unique.length} rulings in ${links.length} Markdown directories.`);
