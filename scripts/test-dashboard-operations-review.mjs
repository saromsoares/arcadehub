import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardHarness } from './dashboard-test-harness.mjs';

test('commercial-plan receipt comparison excludes rejected payments',()=>{
  const h=dashboardHarness({modules:['dashboard-finance.js','dashboard-operations.js']});
  h.run("stripeRecebimentos=[{stripe_id:'ch_sale',empresa_id:'clickdrop',status:'approved',valor:100,valor_liquido:96,taxa:4,moeda:'BRL',date_approved:'2026-11-14T12:00:00Z'},{stripe_id:'ch_rejected',empresa_id:'clickdrop',status:'rejected',valor:900,valor_liquido:900,taxa:0,moeda:'BRL',date_created:'2026-11-14T12:00:00Z'}]");
  assert.doesNotMatch(h.run("buildPlanosSection('clickdrop')"),/1\.000,00/);
});

test('lead form save and later status drag share a serialized write order',async()=>{
  let resolve;
  const h=dashboardHarness({modules:['dashboard-operations.js'],invoke:()=>new Promise(r=>{resolve=r;})});
  h.context.renderLeads=()=>{};
  h.context.limparLeadForm=()=>{};
  h.context.lerLeadForm=()=>({empresa_id:'clickdrop',nome:'Fixture',status:'novo',email:'unique@example.invalid'});
  h.run("empresasAcessiveis=new Set(['arcade_hub','clickdrop']);empresasAcessiveisErro=false;selLeadCompany='clickdrop';leadEditId='lead-a';leads=[{id:'lead-a',empresa_id:'clickdrop',nome:'Fixture',status:'novo',statusConfirmado:'novo'}]");
  h.context.reviewEvent={preventDefault(){}};
  const save=h.run('salvarLead(reviewEvent)');
  await Promise.resolve();
  const move=h.run("mudarStatusLead('lead-a','proposta')");
  await Promise.resolve();
  resolve({data:{ok:true,lead:{id:'lead-a',empresa_id:'clickdrop',nome:'Fixture',status:'novo'}},error:null});
  await Promise.all([save,move]);
  assert.equal(h.run("leads.find(l=>l.id==='lead-a').status"),'proposta');
});

test('a rejected contribution edit cannot enter confirmed equity or theoretical cash',async()=>{
  const h=dashboardHarness({modules:['dashboard-finance.js','dashboard-operations.js'],query:()=>({data:null,error:{message:'fixture write rejected'}})});
  h.context.renderAll=()=>{};
  h.run("estrutura.aportes.SAROM.Nov=1000;saveEstrutura()");
  await h.run('DashboardOperations.flushStructure()');
  assert.equal(h.run('getTotals().totalAportes'),0);
  assert.equal(h.run('getTotals().caixaAtual'),0);
});

test('contribution confirmation uses its own snapshot while a newer draft fails',async()=>{
  const pending=[];
  const h=dashboardHarness({modules:['dashboard-finance.js','dashboard-operations.js'],query:call=>call.table==='estrutura'?new Promise(resolve=>pending.push({call,resolve})):({data:[],error:null})});
  h.context.renderAll=()=>{};
  h.run("estrutura.aportes.SAROM.Nov=100;saveEstrutura()");
  const saving=h.run('DashboardOperations.flushStructure()');
  await new Promise(resolve=>setImmediate(resolve));
  h.run("estrutura.aportes.SAROM.Nov=200;saveEstrutura()");
  pending[0].resolve({data:{id:'confirmed-structure'},error:null});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending[1].call.payload.aportes.SAROM.Nov,200);
  assert.equal(h.run('getTotalAportes()'),100);
  assert.equal(h.run("getAporteSocioTotal('SAROM')"),100);
  assert.equal(h.run('estrutura.aportes.SAROM.Nov'),200);
  pending[1].resolve({data:null,error:{message:'second snapshot rejected'}});
  await saving;
  assert.equal(h.run('getTotals().totalAportes'),100);
  assert.equal(h.run('getTotals().caixaAtual'),100);
  assert.equal(h.run('estrutura.aportes.SAROM.Nov'),200);
});

test('failed structure hydration never promotes an unconfirmed contribution draft',async()=>{
  const h=dashboardHarness({modules:['dashboard-finance.js','dashboard-operations.js'],query:call=>call.table==='estrutura'?({data:null,error:{message:'structure read failed'}}):({data:call.single?null:[],error:null})});
  h.context.carregarCaixasEmail=async()=>{};
  h.run("estrutura.aportes.SAROM.Nov=100;DashboardOperations.confirmStructureAportes(estrutura);estrutura.aportes.SAROM.Nov=200");
  const failures=await h.run('loadAll(painelEpoch)');
  assert.ok(failures.includes('estrutura'));
  assert.equal(h.run('getTotalAportes()'),100);
});

test('reset clears confirmed contributions and legacy monthly values retain the original owner rule',async()=>{
  const h=dashboardHarness({modules:['dashboard-security.js','dashboard-finance.js','dashboard-operations.js']});
  h.run("estrutura.aportes={Nov:100};DashboardOperations.confirmStructureAportes(estrutura)");
  assert.equal(h.run('getTotalAportes()'),100);
  assert.equal(h.run("getAporteSocioTotal('SAROM')"),100);
  assert.equal(h.run("getAporteSocioTotal('LUIZ')"),0);
  h.context.resetEmailState=()=>{};h.context.renderSaldoNubank=()=>{};
  h.run('painelEpoch++');
  await h.run('resetState()');
  assert.equal(h.run('getTotalAportes()'),0);
  assert.equal(h.run('getTotals().caixaAtual'),0);
});
