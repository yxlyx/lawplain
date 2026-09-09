import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../src/app/globals.css',import.meta.url),'utf8');
function luminance(hex){const rgb=hex.match(/[a-f0-9]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
for(const theme of ['light','dark']) test(`${theme} palette maintains AA text contrast on reading surfaces`,()=>{
 const block=theme==='light'?css.match(/:root \{([^}]+)\}/)[1]:css.match(/:root\[data-theme="dark"\] \{([^}]+)\}/)[1];
 const vars=Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[a-f0-9]{6})/g)].map(m=>[m[1],m[2]]));
 for(const fg of ['foreground','muted','muted-2','accent'])for(const bg of ['background','surface','surface-2'])assert.ok(contrast(vars[fg],vars[bg])>=4.5,`${theme} ${fg}/${bg}: ${contrast(vars[fg],vars[bg])}`);
 assert.ok(contrast(vars.primary,vars['primary-fg'])>=4.5);
 assert.ok(contrast(vars.accent,vars['primary-fg'])>=4.5);
});
