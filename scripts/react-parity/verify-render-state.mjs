import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {packLocalArtifacts,runConsumer} from './verify-packages.mjs';
import {fileHashes,sha256} from './langgraph-candidate-package.mjs';
import {assertInstalledInputs} from './ag-ui-candidate-package.mjs';
import {checkTypes} from './verify-langgraph-candidate.mjs';
import {renderStatePresentationSeeds,installPresentationConsumer,presentationConfiguration,readPresentation} from './markdown-presentation-build.mjs';
import {assertArtifactFiles,assertFrozen,retainMarkdownSources,verifyMarkdownBrowser} from './verify-markdown.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const writeJson=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');
export const sequence=[
  'Same reference','Equal primitive','Accept object','Ordered batch',
  'Remove React','Write absent React','Mount React','Remove Angular','Write absent Angular','Mount Angular',
  'Switch owner','Write old','Accept second','Switch again','Write second old','Accept third',
  'Dispose all','Try disposed','Teardown',
];
const shell=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="icon" href="data:,"><title>Installed render-state borrowers</title><style>body{font:16px system-ui;line-height:1.5;margin:24px;background:#fafafa;color:#222}main{max-width:1080px;margin:auto}h1{font-size:1.8rem}h2{font-size:1.2rem}button{font:inherit;padding:6px 10px;margin:3px}button:enabled{background:#164544;color:white}.panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.panels article{min-width:0;padding:16px;background:white;border:1px solid #ccc}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}@media(max-width:600px){.panels{grid-template-columns:minmax(0,1fr)}}</style><main><h1>Application-owned render state</h1><p>Native React and Angular borrow the same actual snapshot.</p><h2>Caller controls</h2><div id="controls"></div><div class="panels"><article><h2>React</h2><div id="react"></div></article><article><h2>Angular</h2><div id="angular"></div></article></div><h2>Actual owner observations</h2><pre id="evidence"></pre></main></html>`;

export function assertFeatureInputs(inputs) {
  for (const required of [
    'node_modules/@threadplane/content/src/render-state/index.js',
    'node_modules/@threadplane/content/src/render-state/owned-value.js',
    'node_modules/@threadplane/content/src/render-state/pointer.js',
    'node_modules/@threadplane/content/src/render-state/create-render-state.js',
    'node_modules/@threadplane/react/src/use-agent.js',
    'node_modules/@threadplane/angular/fesm2022/threadplane-angular.mjs',
  ]) assert.ok(inputs.includes(required),'Installed implementation required: '+required);
  for (const path of inputs) {
    assert.doesNotMatch(path,/(?:^|\/)libs\//,'No workspace source alias');
    assert.doesNotMatch(path,/@(?:json-render|cacheplane|langchain|ag-ui)\/|node_modules\/(?:openai|langchain)\/|@(?:anthropic-ai|mastra)\/|@threadplane\/(?:a2ui|ag-ui|langgraph|render|chat|debug)\/|@threadplane\/content\/src\/(?:a2ui|markdown|json|messages)\//,'Unrelated runtime input');
  }
}
export function requestPolicy(origin,assets=[],limit=16) {
  const parsed=new URL(origin);
  assert.equal(parsed.protocol,'http:','Owned HTTP origin required');
  assert.equal(parsed.hostname,'127.0.0.1','Owned loopback origin required');
  assert.equal(parsed.origin,origin,'Canonical origin required');
  assert.ok(Number.isInteger(limit)&&limit>0);
  const allowed=new Set(['/presentation',...assets]);
  let count=0;
  return (url,method)=>{
    const target=new URL(url);
    return ++count<=limit && method==='GET' && target.origin===origin && !target.search && allowed.has(target.pathname);
  };
}
export function assertOwnerAccounting(evidence) {
  assert.equal(evidence.constructed,evidence.owners.length,'Actual construction count');
  assert.equal(evidence.owners[evidence.selected]?.id,evidence.selected,'Selected owner identity');
  assert.equal(evidence.snapshotId,evidence.owners[evidence.selected].snapshotId,'Actual selected owner snapshot identity');
  assert.deepEqual(evidence.snapshot,evidence.owners[evidence.selected].snapshot,'Actual selected owner data');
  for (const key of ['sameReference','stableRead','retainedStable','frozenSnapshot']) assert.equal(evidence[key],true,key);
  evidence.owners.forEach((owner,id)=>{
    assert.equal(owner.id,id);
    for (const key of ['set','update','dispose']) assert.ok(Number.isInteger(owner[key])&&owner[key]>=0,'Actual command counter '+key);
    assert.ok(owner.dispose<=1,'One caller disposal per owner');
    assert.equal(owner.labelRead,owner.snapshot.label,'Actual owner path read remains available');
    for (const framework of ['react','angular']) {
      const count=owner[framework];
      for (const key of ['registrations','cleanups','outstanding','notifications','reads']) assert.ok(Number.isInteger(count[key])&&count[key]>=0,'Observer counter '+key);
      assert.equal(count.registrations-count.cleanups,count.outstanding,'Independent release handles');
      assert.equal(count.outstanding,id===evidence.selected && evidence.mounted[framework]?1:0,'Only mounted current borrower remains');
      if (id===evidence.selected && evidence.mounted[framework])
        assert.equal(evidence.viewReferences[framework],evidence.snapshotId,'Exact borrowed snapshot reference');
    }
  });
}
const literal={
  'Accept object':{label:'initial',detail:{count:1},phase:'idle'},
  'Ordered batch':{label:'ordered',detail:{count:3},phase:'complete'},
  'Write absent React':{label:'absent-react',detail:{count:3},phase:'complete'},
  'Write absent Angular':{label:'absent-angular',detail:{count:3},phase:'complete'},
  'Switch owner':{label:'second',detail:{count:10},phase:'idle'},
  'Accept second':{label:'second-current',detail:{count:10},phase:'idle'},
  'Switch again':{label:'third',detail:{count:20},phase:'idle'},
  'Accept third':{label:'third-current',detail:{count:20},phase:'ready'},
};
const changes={
  'Accept object':{path:'/detail',value:{count:1}},
  'Ordered batch':{path:'/phase',value:'complete'},
  'Write absent React':{path:'/label',value:'absent-react'},
  'Write absent Angular':{path:'/label',value:'absent-angular'},
  'Accept second':{path:'/label',value:'second-current'},
  'Accept third':{path:'/phase',value:'ready'},
};
export function assertStateTransition(before,next,action) {
  assert.ok(sequence.includes(action),'Known explicit control');
  const switched=action.startsWith('Switch');
  assert.equal(next.constructed,before.constructed+(switched?1:0),'Application-only construction');
  assert.equal(next.selected,before.selected+(switched?1:0),'Selected actual owner');
  const publishing=Object.hasOwn(changes,action);
  if (literal[action]) assert.deepEqual(next.snapshot,literal[action],'Independent literal state for '+action);
  else assert.deepEqual(next.snapshot,before.snapshot,'Retained current state for '+action);
  if (publishing||switched) assert.notEqual(next.snapshotId,before.snapshotId,'Actual snapshot reference changes');
  else assert.equal(next.snapshotId,before.snapshotId,'Actual snapshot reference retained');
  assert.deepEqual(next.lastChange,switched?null:changes[action]??before.lastChange,'Atomic committed metadata');
  for (const [id,owner] of next.owners.entries()) {
    const prior=before.owners[id];
    if (!prior) {
      assert.equal(owner.set,0);assert.equal(owner.update,0);assert.equal(owner.dispose,0);
      continue;
    }
    const oldTarget=action==='Write old'?0:action==='Write second old'?1:-1;
    const currentTarget=id===before.selected;
    const setDelta=(action==='Try disposed'||id===oldTarget||(currentTarget&&['Same reference','Equal primitive','Accept object','Write absent React','Write absent Angular','Accept second'].includes(action)))?1:0;
    const updateDelta=(action==='Try disposed'||(currentTarget&&['Ordered batch','Accept third'].includes(action)))?1:0;
    assert.equal(owner.set-prior.set,setDelta,action+' owner '+id+' set calls');
    assert.equal(owner.update-prior.update,updateDelta,action+' owner '+id+' update calls');
    assert.equal(owner.dispose-prior.dispose,action==='Dispose all'?1:0,action+' caller disposal');
    for (const framework of ['react','angular']) assert.equal(owner[framework].notifications-prior[framework].notifications,(publishing&&currentTarget&&before.mounted[framework])?1:0,action+' actual '+framework+' publication');
    if (id===oldTarget) assert.equal(owner.snapshot.label,id===0?'retired-first':'retired-second','Retired owner stays writable');
    if (action==='Try disposed') {
      assert.equal(owner.dispose,1);
      assert.equal(owner.snapshotId,prior.snapshotId);
      assert.deepEqual(owner.snapshot,prior.snapshot);
      assert.deepEqual(owner.lastChange,prior.lastChange);
    }
  }
  if (action==='Try disposed') {
    const errors=next.error.split('; ');
    assert.equal(errors.length,next.owners.length*2,'Each actual owner rejects set and update');
    for (const error of errors) assert.match(error,/disposed/i,'Each disposed write rejects for terminal lifetime');
  }
  if (action==='Teardown') for (const owner of next.owners) {
    assert.equal(owner.dispose,1);
    for (const framework of ['react','angular']) assert.equal(owner[framework].outstanding,0);
  }
  return publishing;
}

export function buildRenderStatePresentation(consumer,expected) {
  const sourceFiles=['state.ts','react.tsx','angular.ts'];
  for (const file of sourceFiles) cpSync(join(root,'fixtures/react-parity/render-state',file),join(consumer,file));
  writeFileSync(join(consumer,'presentation.html'),shell);
  const {workspace,typescript}=presentationConfiguration();
  const options=workspace.projects.presentation.architect.build.options;
  options.browser='react.tsx';options.optimization=false;options.define={'process.env.NODE_ENV':'"development"'};
  typescript.files=['react.tsx'];
  writeJson(join(consumer,'angular.json'),workspace);writeJson(join(consumer,'tsconfig.presentation.json'),typescript);
  const types=checkTypes(consumer,'tsconfig.presentation.json');
  assertInstalledInputs(consumer,types.map(record=>record.path),expected);
  for (const path of [
    'node_modules/@threadplane/content/src/render-state/index.d.ts',
    'node_modules/@threadplane/content/src/render-state/types.d.ts',
    'node_modules/@threadplane/content/src/render-state/create-render-state.d.ts',
    'node_modules/@threadplane/react/src/use-agent.d.ts',
    'node_modules/@threadplane/angular/types/threadplane-angular.d.ts',
  ]) assert.ok(types.some(record=>record.path===path),'Actual installed declaration required: '+path);
  console.log(runConsumer(process.execPath,['node_modules/@angular/cli/bin/ng.js','build','presentation'],consumer));
  const inputs=Object.keys(json(join(consumer,'presentation-output/stats.json')).inputs);
  assertInstalledInputs(consumer,inputs,expected);assertFeatureInputs(inputs);
  for (const file of ['react.development.js','react-dom-client.development.js']) assert.ok(inputs.some(path=>path.endsWith('/'+file)),'Development StrictMode implementation '+file);
  const outputs=fileHashes(join(consumer,'presentation-output')).map(record=>({...record,path:'presentation-output/'+record.path}));
  return {
    types,inputs,outputs,
    inputHashes:inputs.map(path=>({path,sha256:sha256(readFileSync(resolve(consumer,path)))})),
    files:[...sourceFiles,'presentation.html','angular.json','tsconfig.presentation.json'].map(path=>({path,sha256:sha256(readFileSync(join(consumer,path)))})),
    shell:'presentation-output/browser/index.html',
    assets:outputs.filter(record=>record.path.startsWith('presentation-output/browser/')&&!record.path.endsWith('/index.html')),
  };
}

export async function verifyRenderStateBrowser(browser,url,{assets=[],screenshot}={}) {
  const page=await browser.newPage();
  page.setDefaultTimeout(15000);
  const problems=[],rejected=[],requests=[],steps=[];
  const allow=requestPolicy(url,assets);
  page.on('pageerror',error=>problems.push(error.message));
  page.on('console',message=>{if (['warning','error'].includes(message.type())) problems.push(message.text());});
  await page.route('**/*',route=>{
    const request=route.request();requests.push({url:request.url(),method:request.method()});
    if (!allow(request.url(),request.method())) {rejected.push(request.url());return route.abort();}
    return route.continue();
  });
  const read=()=>page.evaluate(()=>window.__renderState());
  const settle=()=>page.waitForFunction(()=>window.__renderState?.().ready&&!window.__renderState().busy&&window.__renderState().sameReference);
  const dom=async(evidence,expected)=>{
    for (const framework of ['react','angular']) {
      const panel=page.getByRole('region',{name:(framework==='react'?'React':'Angular')+' render state'});
      assert.equal(await panel.count(),evidence.mounted[framework]?1:0);
      if (evidence.mounted[framework]) {
        assert.deepEqual(JSON.parse(await panel.locator('pre').textContent()),expected,framework+' literal DOM');
        assert.equal(await panel.locator('p').textContent(),expected.label,framework+' visible label');
        assert.equal(evidence.viewReferences[framework],evidence.snapshotId,'Borrowed actual owner reference');
      }
    }
  };
  let expected={label:'initial',detail:{count:0},phase:'idle'};
  try {
    await page.goto(url+'/presentation');await settle();
    await page.waitForFunction(()=>window.__renderState().owners[0].react.registrations>=2&&window.__renderState().owners[0].react.cleanups>=1);
    let evidence=await read();assertOwnerAccounting(evidence);await dom(evidence,expected);
    assert.deepEqual(evidence.snapshot,expected);assert.equal(evidence.constructed,1);assert.equal(evidence.lastChange,null);
    for (const key of ['set','update','dispose']) assert.equal(evidence.owners[0][key],0,'No mount command '+key);
    for (const framework of ['react','angular']) assert.equal(evidence.owners[0][framework].notifications,0);
    const replay=evidence.owners[0].react;steps.push({action:'Initial development replay',...evidence});
    for (const [index,action] of sequence.entries()) {
      const before=await read();await page.getByRole('button',{name:action,exact:true}).click();
      await page.waitForFunction(step=>window.__renderState().step===step,index+1);await settle();
      evidence=await read();assertOwnerAccounting(evidence);assertStateTransition(before,evidence,action);
      expected=literal[action]??expected;await dom(evidence,expected);
      if (action==='Dispose all') {
        assert.equal(evidence.mounted.react,true);assert.equal(evidence.mounted.angular,true);
        for (const owner of evidence.owners) assert.equal(owner.dispose,1);
      }
      if (action==='Mount React') assert.ok(evidence.owners[0].react.cleanups>before.owners[0].react.cleanups,'Actual remount development cleanup replay');
      if (screenshot&&action==='Ordered batch') await page.screenshot({path:screenshot,fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
      steps.push({action,...evidence});
    }
    assert.deepEqual(problems,[]);assert.deepEqual(rejected,[]);assert.ok(requests.length<=16);
    return {replay,requests,rejected,problems,steps};
  } finally {await page.close();}
}

async function ownedLaunch(cleanup) {
  const {chromium}=await import('@playwright/test');
  const server=await chromium.launchServer();
  const child=server.process();
  cleanup.pid=child.pid;
  cleanup.profile=child.spawnargs.find(arg=>arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
  let browser;
  try {
    assert.ok(cleanup.profile,'Actual owned Chromium profile required');
    browser=await chromium.connect(server.wsEndpoint());
  }
  catch(error) {await server.close();throw error;}
  return {newPage:(...args)=>browser.newPage(...args),close:async()=>{
    try {await browser.close();} finally {
      await server.close();
      cleanup.browserExited=child.exitCode!==null||child.signalCode!==null;
      cleanup.profileRemoved=!existsSync(cleanup.profile);
      assert.equal(cleanup.browserExited,true,'Actual browser process exited');
      assert.equal(cleanup.profileRemoved,true,'Actual owned browser profile removed');
    }
  }};
}

export async function verifyRenderState({retain,launch}={}) {
  const temporary=retain?resolve(retain):mkdtempSync(join(tmpdir(),'owned-render-state-'));
  if (retain) {assert.equal(existsSync(temporary),false,'Retain requires NEW_DIRECTORY');mkdirSync(temporary);}
  const cleanup={retainedConsumer:Boolean(retain)};
  try {
    const tarballs=packLocalArtifacts(root,temporary,['core','content','react','angular']);
    assert.equal(Object.keys(tarballs).length,4,'Exactly four mixed borrower artifacts');
    const expected=Object.fromEntries(Object.keys(tarballs).map(name=>[name,fileHashes(join(temporary,'packed-'+name.split('/')[1],'package'))]));
    const consumer=join(temporary,'consumer');mkdirSync(consumer);
    const rootLockSha256=sha256(readFileSync(join(root,'package-lock.json')));
    const installation=installPresentationConsumer(consumer,json(join(root,'package-lock.json')),tarballs,{seeds:renderStatePresentationSeeds,profile:'render-state'});
    for (const [name,files] of Object.entries(expected)) assertArtifactFiles(join(consumer,'node_modules',name),files);
    const presentation=buildRenderStatePresentation(consumer,expected);
    const sourcePaths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','--','libs/core','libs/content','libs/react','libs/angular','fixtures/react-parity/render-state','scripts/react-parity','package-lock.json','package.json','tsconfig.base.json','nx.json','.github/workflows/ci.yml'],{cwd:root,encoding:'utf8'}).trim().split('\n');
    const sources=retainMarkdownSources(root,temporary,[...new Set(sourcePaths)].sort());
    const frozen=[
      ...sources,
      ...presentation.outputs.map(record=>({...record,path:'consumer/'+record.path})),
      ...[...presentation.files,...presentation.types,...presentation.inputHashes].map(record=>({...record,path:'consumer/'+record.path})),
      ...Object.values(tarballs).map(path=>({path:path.slice(5).slice(temporary.length+1),sha256:sha256(readFileSync(path.slice(5)))})),
      ...['package.json','package-lock.json'].map(path=>({path:'consumer/'+path,sha256:sha256(readFileSync(join(consumer,path)))})),
    ];
    const provenance={rootLockSha256,installation,expected,presentation,sources,frozen,node:process.version,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()};
    writeJson(join(temporary,'provenance.json'),provenance);
    const assets=readPresentation(temporary,provenance);
    let origin,result;
    try {
      result=await verifyMarkdownBrowser('',{
        launch:async url=>{origin=url;return launch?launch(url):ownedLaunch(cleanup);},
        presentation:assets,
        check:(browser,url)=>verifyRenderStateBrowser(browser,url,{assets:Object.keys(assets.assets),screenshot:join(temporary,'ordered-batch.png')}),
      });
    } finally {
      if (origin) {await assert.rejects(fetch(origin),/fetch failed/,'Owned loopback socket closed');cleanup.origin=origin;cleanup.serverClosed=true;}
      writeJson(join(temporary,'cleanup.json'),cleanup);
    }
    for (const [name,files] of Object.entries(expected)) assertArtifactFiles(join(consumer,'node_modules',name),files);
    assertFrozen(temporary,frozen);
    assert.equal(sha256(readFileSync(join(root,'package-lock.json'))),rootLockSha256);
    writeJson(join(temporary,'browser-result.json'),{...result,cleanup});
    console.log('Installed render-state observation verified: '+temporary);
    return {temporary:realpathSync(temporary),provenance,result:{...result,cleanup}};
  } finally {if (!retain) rmSync(temporary,{recursive:true,force:true});}
}
if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.length===2||(process.argv.length===4&&process.argv[2]==='--retain'),'Usage: verify-render-state.mjs [--retain NEW_DIRECTORY]');
  await verifyRenderState({retain:process.argv[3]});
}
