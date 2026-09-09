import test from 'node:test';
import assert from 'node:assert/strict';
import { answerSources } from '../src/lib/answer-sources.ts';

test('answer sources deduplicate canonical documents while retaining citation order',()=>{
 const sources=answerSources('[Case A](/judgment/2010_SGCA_26?q=defamation#p37) and [same](https://lawplain.com/judgment/2010_SGCA_26) plus [Act](/statute/PDPA2012)');
 assert.deepEqual(sources,[{href:'/judgment/2010_SGCA_26',label:'Case A',kind:'Singapore judgment'},{href:'/statute/PDPA2012',label:'Act',kind:'Singapore legislation'}]);
});
test('answer source cards exclude untrusted origins, non-document links and unsafe schemes',()=>{
 assert.deepEqual(answerSources('[fake](https://lawplain.com.evil.test/judgment/a) [bad](javascript:alert) [account](/saved) [external](https://example.com/statute/a) [protocol](//evil.test/judgment/a)'),[]);
});
test('streaming partial links do not become source cards',()=>{
 assert.deepEqual(answerSources('Read [case](/judgment/2010_SGCA_26'),[]);
});
