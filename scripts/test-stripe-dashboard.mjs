// Executes dashboard logic with DOM/SDK fixtures, not a browser or a live login.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html = readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
const elements = new Map();
let callback, renders=0, companyRendered=null, reads=0;
const sdk = {
  auth:{onAuthStateChange(){}},
  channel(){return {on(_event,_filter,fn){callback=fn; return this;},subscribe(){return this;}};},
  from(){reads++; throw new Error('Unexpected database request');},
};
const context = vm.createContext({
  console, assert, URL, Date, Intl, Set, Map, Promise,
  window:{location:{hash:''}}, supabase:{createClient:()=>sdk},
  document:{addEventListener(){},querySelectorAll:()=>[],getElementById(id){
    if(!elements.has(id)) elements.set(id,{innerHTML:'',textContent:'',style:{},dataset:{},addEventListener(){},querySelectorAll:()=>[],classList:{contains:()=>false}});
    return elements.get(id);
  }},
  setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},
});
new vm.Script(script,{filename:'admin-inline.js'}).runInContext(context);
const run=code=>vm.runInContext(code,context);
run(`stripeSaldo={ok:true,saldo_ok:true,parcial:false,conta:{nome:'ARCADE HUB TECH + ClickDrop'},
  saldo:{disponivel:-0.28,a_liberar:114.38,total:114.10,moeda:'BRL'},
  contas:[{nome:'ARCADE HUB TECH',ok:true,saldo:{disponivel:-0.28,a_liberar:18.86}},
          {nome:'ClickDrop',ok:true,saldo:{disponivel:0,a_liberar:95.52}}]};
  stripeSaldoLoading=true;
  stripeRecebimentos=[{id:'fixture',status:'approved',empresa_id:'clickdrop',valor:99.90,
    valor_liquido:95.52,taxa:4.38,moeda:'BRL',date_approved:EXERCICIO+'-11-14T12:00:00Z',
    raw:{account_source:'clickdrop'},descricao:'Fixture'}];`);
assert.equal(run("getStripeReceita('Nov','clickdrop')"),99.90);
assert.equal(run("getStripeReceita('Nov','arcade_hub')"),0);
assert.equal(run("getEmpresaMes('clickdrop','Nov').receitaStripe"),99.90);
assert.equal(run('saldoDisponivelStripe()'),-0.28);
assert.match(run('estadoCartaoStripe().extra'),/ClickDrop: disponível.*0,00, a liberar.*95,52/);
context.saldoDisponivelMercadoPago=()=>100;
assert.equal(run('estadoCaixaSaldos().valor'),99.72);
run('stripeSaldo.parcial=true');
assert.match(run('estadoCaixaSaldos().sub'),/parcial/);
assert.match(run('estadoCartaoStripe().sub'),/parcial/);
run('renderStripe()');
const table=elements.get('stripe-receb-body').innerHTML;
assert.match(table,/Conta ClickDrop/);
assert.match(table,/99,90/); assert.match(table,/4,38/); assert.match(table,/95,52/);
assert.equal((table.match(/<td\b/g)||[]).length,9);
for(const name of ['renderPainel','renderLancamentos','renderPlanejado','renderComparativo','renderEstrutura',
  'renderEmpresasGeral','renderBalancoSocios','renderCalendario','renderMercadoPago','renderStripe',
  'renderCartoesFinanceiro','renderContatos','renderLeads','renderEmails','renderAcessos','renderNavEmpresas','aplicarMenu']) context[name]=()=>{};
context.renderEmpresaIndividual=id=>{companyRendered=id;};
run("currentEmpresaId='clickdrop';renderAll()");
assert.equal(companyRendered,'clickdrop');
context.renderAll=()=>{renders++;};
assert.ok(callback,'Realtime registered');
callback({eventType:'INSERT',new:{id:'live_fixture',status:'approved',empresa_id:'clickdrop',valor:99.90,moeda:'BRL'}});
assert.equal(renders,1,'Realtime refreshes financial aggregators');
run("paginasBloqueadas=new Set(['stripe'])");
callback({eventType:'INSERT',new:{id:'blocked_fixture'}});
assert.equal(renders,1,'blocked page does not refresh or retain incoming receipts');
assert.equal(run("stripeRecebimentos.some(r=>r.id==='blocked_fixture')"),false);
await run('carregarRecebimentosStripe()');
assert.equal(reads,0,'blocked page never queries Stripe receipts');
console.log('Dashboard Stripe PASS; DOM/SDK fixtures, no browser or network.');
