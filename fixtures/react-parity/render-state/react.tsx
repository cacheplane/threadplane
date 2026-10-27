import React,{useLayoutEffect} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {bootstrapApplication} from '@angular/platform-browser';
import {provideZonelessChangeDetection,type ApplicationRef} from '@angular/core';
import {useAgent} from '@threadplane/react';
import {AngularView} from './angular';
import {selected,generations,selectNext,views,mounted,state,sequence,draw,element} from './state';

let reactRoot:Root|undefined,angularApp:ApplicationRef|undefined;
function ReactView({observer}:{observer:typeof selected.react}) {
  const snapshot=useAgent(observer);
  useLayoutEffect(()=>{views.react=snapshot;draw();return ()=>{delete views.react;};},[snapshot]);
  return <section aria-label="React render state"><p>{String(snapshot['label'])}</p><pre>{JSON.stringify(snapshot)}</pre></section>;
}
function renderReact() {reactRoot?.render(<React.StrictMode><ReactView observer={selected.react}/></React.StrictMode>);}
function mountReact() {reactRoot=createRoot(element('react')); mounted.react=true;renderReact();}
function removeReact() {reactRoot?.unmount();reactRoot=undefined;mounted.react=false;}
async function mountAngular() {
  element('angular').replaceChildren(document.createElement('state-observer'));
  angularApp=await bootstrapApplication(AngularView,{providers:[provideZonelessChangeDetection()]});
  mounted.angular=true;
}
function removeAngular() {angularApp?.destroy();angularApp=undefined;mounted.angular=false;element('angular').replaceChildren();}
async function switchOwner() {removeAngular();selectNext();renderReact();await mountAngular();}
function teardown() {removeReact();removeAngular();}
// All commands belong to these application controls, outside both borrower views.
const actions:(()=>void|Promise<void>)[]=[
  ()=>selected.owner.set('/detail',selected.owner.get('/detail')),
  ()=>selected.owner.set('/label','initial'),
  ()=>selected.owner.set('/detail',{count:1}),
  ()=>selected.owner.update({'/detail':{count:2},'/detail/count':3,'/label':'ordered','/phase':'complete'}),
  removeReact,()=>selected.owner.set('/label','absent-react'),mountReact,
  removeAngular,()=>selected.owner.set('/label','absent-angular'),mountAngular,
  switchOwner,()=>generations[0].owner.set('/label','retired-first'),()=>selected.owner.set('/label','second-current'),
  switchOwner,()=>generations[1].owner.set('/label','retired-second'),()=>selected.owner.update({'/label':'third-current','/phase':'ready'}),
  ()=>{for (const generation of generations) generation.owner.dispose();},
  ()=>{
    const errors:string[]=[];
    for (const generation of generations) {
      for (const command of [()=>generation.owner.set('/label','forbidden'),()=>generation.owner.update({'/phase':'forbidden'})]) {
        try {command();} catch(error) {errors.push(String(error));}
      }
    }
    if (errors.length !== generations.length*2) throw new Error('Disposed command accepted');
    state.error=errors.join('; ');
  },
  teardown,
];
sequence.forEach((label,index)=>{
  const button=document.createElement('button');button.textContent=label;
  button.addEventListener('click',async()=>{
    if (state.busy || state.step !== index) return;
    state.busy=true;draw();
    try {await actions[index]();state.step++;} catch(error) {state.error=String(error);throw error;}
    finally {state.busy=false;draw();}
  });
  element('controls').append(button);
});
window.addEventListener('pagehide',teardown);
mountReact();void mountAngular().then(()=>{state.ready=true;draw();});
