import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('F3 report-controlled fields are rendered as text, never HTML',()=>{
  let unsafeWrites=0;
  class Element {
    children=[];ownText='';dataset={};
    get textContent(){return this.ownText+this.children.map(c=>c.textContent).join('');}
    set textContent(v){this.ownText=v;this.children=[];}
    classList={remove(){},toggle(){},add(){}};
    set innerHTML(value){if(value!==''){unsafeWrites++;throw new Error('untrusted HTML sink');}this.children=[];}
    append(...children){this.children.push(...children)} appendChild(child){this.append(child)}
    addEventListener(){} querySelector(){return this.children[0]} querySelectorAll(){return this.children}
  }
  const elements=new Map();const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();}};
  const attack='<img src=x onerror="document.title=123">';
  const report={summary:{overall:'DIVERGENT',pass:0,divergence:1,test_count:1,divergent_vector_ids:[attack]},corpus:{id:attack},target:{id:attack},results:[{status:'DIVERGENCE',vector_id:attack,description:attack,expected:{decision:attack},observed:{decision:attack,reason:attack}}],reproduction:{one_liner:attack,clean_clone:attack}};
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  vm.runInNewContext(source+'\nrenderReport(report)',{document,report,fetch:()=>new Promise(()=>{}),navigator:{}});
  assert.equal(unsafeWrites,0); const row=elements.get('vectorList').children[0];
  assert.equal(row.children[1].children[0].textContent,attack);
  assert.ok(row.children[1].children[2].textContent.includes(attack));
  assert.ok(elements.get('failurePre').textContent.includes(attack.replaceAll('"','\\"')));
});
