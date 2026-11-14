// Executes the real inline + security module against DOM/Auth fixtures, never a browser or network.
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('../admin/index.html',import.meta.url),'utf8');
const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
const security=readFileSync(new URL('../admin/dashboard-security.js',import.meta.url),'utf8');
function fixture(){
  const nodes=new Map(),authCallbacks=[],listeners={},cleared=[],clipboard=[];
  let invoke=async()=>({data:{ok:true},error:null}),updateResult={data:null,error:{message:'fixture failure'}},draftClears=0,reloads=0,signOut=async()=>{};
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{id,value:'',innerHTML:'',textContent:'',style:{},dataset:{},isConnected:true,type:'text',
      addEventListener(){},querySelectorAll:()=>[],replaceChildren(){},focus(){},classList:{add(){},remove(){},contains:()=>false}});
    return nodes.get(id);
  };
  const sdk={auth:{onAuthStateChange(fn){authCallbacks.push(fn);},signOut:()=>signOut()},removeAllChannels:async()=>{},functions:{invoke:(...args)=>invoke(...args)},
    from(){return {update(){return this;},eq(){return this;},select(){return this;},maybeSingle:async()=>updateResult};}};
  const context=vm.createContext({console,Date,Intl,URL,Map,Set,Promise,TextEncoder,crypto:webcrypto,
    window:{location:{hash:'',reload(){reloads++;}}},supabase:{createClient:()=>sdk},
    document:{getElementById:node,querySelectorAll:()=>[],addEventListener(type,fn){(listeners[type]||=[]).push(fn);}},
    navigator:{clipboard:{writeText:async value=>clipboard.push(value)}},
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval:id=>cleared.push(id),alert(){},confirm:()=>true,prompt:()=>null});
  new vm.Script(inline,{filename:'admin-inline.js'}).runInContext(context);
  for(const name of ['resetEmailState','renderSaldoNubank','cancelarSavesPendentes','pararEsperaRelatorioMP'])context[name]=()=>{};
  context.DashboardOperations={limparDraftsDaSessao(){draftClears++;}};
  new vm.Script(security,{filename:'dashboard-security.js'}).runInContext(context);
  const run=code=>vm.runInContext(code,context);
  return {run,node,context,authCallbacks,listeners,cleared,clipboard,setInvoke:fn=>{invoke=fn;},setSignOut:fn=>{signOut=fn;},setUpdate:value=>{updateResult=value;},draftClears:()=>draftClears,reloads:()=>reloads};
}
const checks=[];
{
  const f=fixture();
  f.run(`acessosEmpresas=[{id:'fixture',empresa_id:'clickdrop',empresa_nome:'A & B',usuario:'&#34;); fixtureInjected=1;//',rotulo:'<b>text</b>'}];renderAcessos()`);
  const generated=f.node('acessos-list').innerHTML;
  assert.ok(!generated.includes('onclick='));
  assert.ok(generated.includes('&amp;#34;'));
  assert.ok(generated.includes('&lt;b&gt;text&lt;/b&gt;'));
  assert.ok(generated.includes('data-access-action="copy-user"'));
  assert.equal(f.node('acesso-senha').type,'password');
  checks.push('access data are escaped text and delegated actions, not inline JavaScript');
}
{
  const f=fixture(); let finish;
  f.setInvoke(()=>new Promise(resolve=>{finish=resolve;}));
  f.run(`mestraDigitada='fixture-master';acessosMestraOk=true;`);
  const pending=f.run(`buscarSenhaAcesso('fixture')`);
  f.run('painelEpoch++'); await f.run('resetState()');
  finish({data:{senha:'fixture-secret'},error:null});
  assert.equal(await pending,null);assert.equal(f.run('senhasReveladas.size'),0);
  checks.push('late credential response cannot repopulate a logged-out session');
}
{
  const f=fixture(); let finish;
  f.setInvoke(()=>new Promise(resolve=>{finish=resolve;}));
  f.run(`mestraDigitada='fixture-master';acessosMestraOk=true;`);
  const pending=f.run(`copiarSenhaAcesso('fixture')`);
  await Promise.resolve();
  f.run('painelEpoch++');await f.run('resetState()');
  finish({data:{senha:'fixture-secret'},error:null});await pending;
  assert.equal(f.clipboard.length,0);
  checks.push('copy cannot write a credential after its session changed');
}
{
  const f=fixture();
  f.run('stripeRealtimeOn=true;mpRealtimeOn=true;stripePollTimer=10;mpPollTimer=11;nuPollTimer=12;mpSaldoLoading=true;stripeSaldoLoading=true;nuSaldoLoading=true');
  await f.run('resetState()');
  assert.equal(f.run('stripeRealtimeOn'),false);assert.equal(f.run('mpRealtimeOn'),false);
  assert.equal(f.run('mpSaldoLoading||stripeSaldoLoading||nuSaldoLoading'),false);
  assert.equal(f.run('stripePollTimer||mpPollTimer||nuPollTimer'),null);
  assert.deepEqual(f.cleared,[11,10,12]);
  checks.push('reset clears all financial polling and subscription flags');
}
{
  const f=fixture();
  f.run(`stripeRecebimentos=[{id:'row',empresa_id:'priva_br',status:'approved'}]`);
  let redraws=0;f.context.renderStripe=()=>{redraws++;};
  await f.run(`atribuirEmpresaStripe('row','clickdrop')`);
  assert.equal(f.run('stripeRecebimentos[0].empresa_id'),'priva_br');assert.equal(redraws,1);
  f.setUpdate({data:{id:'row',empresa_id:'clickdrop'},error:null});f.context.renderAll=()=>{};
  await f.run(`atribuirEmpresaStripe('row','clickdrop')`);
  assert.equal(f.run('stripeRecebimentos[0].empresa_id'),'clickdrop');
  checks.push('receipt destination changes only after a confirmed server update');
}
{
  const f=fixture();let finish;
  f.setInvoke(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=f.run('verificarMestra()');
  // Empty prompt is rejected without authorizing or touching the server.
  assert.equal(await pending,false);assert.equal(f.run('acessosMestraOk'),false);
  checks.push('master authorization is never inferred from a client hash or missing prompt');
}
{
  const f=fixture(),callback=f.authCallbacks.at(-1);
  callback('INITIAL_SESSION',{user:{id:'user-a'}});
  f.run(`senhasReveladas.set('fixture','fixture-secret');painelEpochCarregado=painelEpoch`);
  const before=f.run('painelEpoch');
  callback('SIGNED_IN',{user:{id:'user-b'}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(f.run('painelEpoch')>before);assert.equal(f.run('senhasReveladas.size'),0);
  assert.equal(f.node('main').style.display,'none');assert.equal(f.reloads(),1);assert.equal(f.draftClears(),1);
  checks.push('principal change without SIGNED_OUT invalidates state and reloads before displaying private data');
}
{
  const f=fixture();let finish;
  f.context.prompt=()=> 'fixture-master';f.setInvoke(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=f.run('verificarMestra()');f.run('painelEpoch++');await f.run('resetState()');
  finish({data:{ok:true},error:null});assert.equal(await pending,false);assert.equal(f.run('acessosMestraOk'),false);assert.equal(f.run('mestraDigitada'),null);
  checks.push('late master verification never authorizes the next session');
}
{
  const f=fixture();let finish;
  f.context.fecharMenu=()=>{};
  f.setSignOut(()=>{assert.equal(f.draftClears(),1);return new Promise(resolve=>{finish=resolve;});});
  const pending=f.run('doLogout()');assert.equal(f.draftClears(),1);assert.equal(f.node('main').style.display,'none');
  finish();await pending;checks.push('logout clears session drafts before awaiting signOut');
}
{
  const f=fixture();f.node('acesso-form').dataset.requestId='old-create-request';
  f.run('abrirFormAcesso()');assert.equal(f.node('acesso-form').dataset.requestId,undefined);
  checks.push('starting a new access does not replay an abandoned create request');
}
console.log(JSON.stringify({checks:checks.length,result:'PASS',scenarios:checks,network:false},null,2));
