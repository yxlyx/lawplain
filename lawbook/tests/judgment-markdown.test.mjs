import test from 'node:test';
import assert from 'node:assert/strict';
import {judgmentMarkdown,parseTextOffset} from '../src/lib/judgment-markdown.ts';

test('long rulings identify partial text and expose the exact continuation offset',()=>{
 const j={citation:'2010_SGCA_26',title:'A v B',body_text:'hello',body_offset:10,body_length:25};
 const r=judgmentMarkdown(j,j.citation,'https://lawplain.com');
 assert.equal(r.next,'https://lawplain.com/judgment/2010_SGCA_26/index.md?offset=15');
 assert.match(r.text,/characters 10–15 of 25/);
 assert.match(r.text,/partial text segment/);
 assert.match(r.text,/\nhello\n/);
});
test('last segment preserves source text and stops pagination',()=>{
 const j={citation:'x',body_text:'[1] Original text.',body_offset:0,body_length:17};
 const r=judgmentMarkdown(j,'x','https://lawplain.com');
 assert.equal(r.next,null);
 assert.match(r.text,/End of available/);
 assert.ok(r.text.includes(j.body_text));
});
test('offset parser rejects negative, fractional, non-numeric and unbounded offsets',()=>{
 for(const value of ['-1','1.5','NaN','1e5','10000001','9007199254740992','']) assert.equal(parseTextOffset(value),null);
 assert.equal(parseTextOffset(null),0);
 assert.equal(parseTextOffset('60000'),60000);
});

test('continuation offsets use SQLite Unicode character counts',()=>{
 const j={citation:'x',body_text:'A😀B',body_offset:0,body_length:6};
 assert.equal(judgmentMarkdown(j,'x','https://lawplain.com').next,'https://lawplain.com/judgment/x/index.md?offset=3');
});
