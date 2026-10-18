// Execute the actual route-selection/link expressions from the TSX source.
// No dependencies, JSX rendering, browser, Docker or database is required.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const original=await readFile('/opt/aia-accreditation/apps/web/src/app/[locale]/admin/setup/setup-view.tsx','utf8');
const fixed=await readFile(new URL('./setup-view.tsx',import.meta.url),'utf8');
const event={id:'00000000-0000-4000-8000-000000000001'};
function expression(source,pattern){const match=source.match(pattern);assert(match);return match[1];}
function evaluate(code,context){return vm.runInNewContext(code,context);}
function links(source,locale){
 const base=evaluate(expression(source,/const base = ([^;]+); const names=/),{locale,event});
 const next=evaluate(expression(source,/<WizardFooter previous=\{`[^`]+`\} next=\{(`[^`]+`)\}/),{base,event});
 const review=source.slice(source.indexOf('function WizardReviewStep('),source.indexOf('function ReviewCard('));
 const edits=[...review.matchAll(/edit=\{(`[^`]+`)\}/g)].map(x=>evaluate(x[1],{base,event}));
 const previous=evaluate(expression(review,/href=\{(`\$\{base\}&step=2[^`]*`)\}/),{base,event});
 return {next,edits,previous};
}
function destination(source,href){
 const url=new URL(href,'https://localhost:18443');
 // Next page searchParams: repeated keys become arrays, even if values match.
 const query=Object.fromEntries([...new Set(url.searchParams.keys())].map(k=>{
  const values=url.searchParams.getAll(k);return[k,values.length===1?values[0]:values];
 }));
 const creating=evaluate(expression(source,/const creating = ([^;]+);/),{query});
 const selected=evaluate(expression(source,/const selectedEvent = ([^;]+);/),{query,creating,data:{events:[event]}});
 const step=evaluate(expression(source,/const step = ([^;]+);/),{query});
 const wizard=source.slice(source.indexOf('function SetupWizard('),source.indexOf('function WizardProgress('));
 const fallback=expression(wizard,/if \(([^)]+)\) return <SetupWizard [^\n]+step=\{1\}/);
 return {step:evaluate(fallback,{step,event:selected})?1:step,event:selected,url,query};
}
for(const locale of ['en','pt']){
 const broken=links(original,locale);
 const oldDestination=destination(original,broken.next);
 assert.equal(oldDestination.url.searchParams.getAll('eventId').length,2);
 assert.equal(oldDestination.event,undefined);assert.equal(oldDestination.step,1);
 for(const href of [...broken.edits.slice(1),broken.previous])assert.equal(destination(original,href).step,1);
 const corrected=links(fixed,locale);
 const review=destination(fixed,corrected.next);
 assert.equal(review.step,3);assert.equal(review.event,event);
 assert.equal(review.query.created,'1');assert.equal(review.url.pathname,`/${locale}/admin/setup`);
 assert.equal(review.url.searchParams.getAll('eventId').length,1);
 for(const [index,href]of corrected.edits.entries()){
  const result=destination(fixed,href);assert.equal(result.step,index===0?1:2);assert.equal(result.event,event);
  assert.equal(result.url.searchParams.getAll('eventId').length,1);
 }
 const previous=destination(fixed,corrected.previous);
 assert.equal(previous.step,2);assert.equal(previous.event,event);
 // Fresh wizard behavior remains intact; only existing event navigation changes.
 const fresh=destination(fixed,`/${locale}/admin/setup?wizard=create&step=1`);
 assert.equal(fresh.step,1);assert.equal(fresh.event,undefined);
}
console.log('PASS: reproduced original step-2-to-step-1 loop; patched Review, both catalogue edit links and Previous preserve one eventId in English and Portuguese.');
