// Verify the promoted application source, rather than testing only archived copies.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const review=new URL('./review/event-ui/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('release.json',review),'utf8'));
assert.equal(manifest.kind,'events-ui-v1');
assert.equal(manifest.migrations,false);
const sha=value=>createHash('sha256').update(value).digest('hex');
for(const item of manifest.changes){
 assert(/^(?:apps|packages)\//.test(item.path)&&!item.path.split('/').includes('..'),'Relative application source path required');
 assert.equal(sha(await readFile(new URL(item.path,root))),item.after,`Published application differs from review: ${item.path}`);
 assert.equal(sha(await readFile(new URL(`overlay/${item.path}`,review))),item.after,`Archived source differs from review: ${item.path}`);
}
console.log(`PASS: ${manifest.changes.length} published application files match the cumulative reviewed staging source.`);
