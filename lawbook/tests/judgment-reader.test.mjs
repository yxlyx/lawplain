import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks } from '../src/lib/sections.ts';

test('a judgment date cannot steal the paragraph sequence', () => {
 const blocks = parseBlocks('28 July 2010\n\nIntroduction\n\n1 First paragraph.\n\n2 Second paragraph.');
 assert.equal(blocks[0].kind, 'para');
 assert.deepEqual(blocks.filter(b => b.kind === 'numbered').map(b => b.num), ['1', '2']);
});
test('quoted provisions preserve indentation and cannot hijack numbering', () => {
 const blocks = parseBlocks('1 First paragraph.\n\n    2 A quoted provision.\n\n2 Second paragraph.\n\n118 Another provision.\n\n3 Third paragraph.');
 assert.equal(blocks[1].kind, 'quote');
 assert.deepEqual(blocks.filter(b => b.kind === 'numbered').map(b => b.num), ['1', '2', '3']);
});
test('bracketed paragraphs retain stable anchors and source offsets', () => {
 const text = '[1] A 😀 reference.\n\n[2] Next paragraph.';
 const blocks = parseBlocks(text);
 assert.deepEqual(blocks.map(b => b.id), ['p-1', 'p-2']);
 assert.equal(text.slice(blocks[1].startOffset, blocks[1].endOffset), '[2] Next paragraph.');
 assert.equal(blocks[0].key, '[1] A 😀 reference.#0');
});
