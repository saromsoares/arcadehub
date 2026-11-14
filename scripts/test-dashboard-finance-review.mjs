import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardHarness } from './dashboard-test-harness.mjs';

test('missing pending balance and Nu source timestamps remain explicitly unknown', () => {
  const h = dashboardHarness();
  assert.equal(h.context.DashboardFinance.forecast().pending, null);
  h.run("nuSaldo={ok:true,saldo_ok:true,saldo:{disponivel:10},atualizado_em:null,consultado_em:'2026-11-14T15:00:00Z'};nuSaldoTs=new Date()");
  assert.match(h.run('estadoSaldoNubank().sub'), /Referência do saldo não informada/);
});

test('report generation is identified separately from its future period end', () => {
  const h = dashboardHarness();
  h.run("mpSaldo={ok:true,saldo_ok:true,saldo:{available_balance:10},referencia_tipo:'geracao_relatorio',relatorio_gerado_em:'2026-11-14T14:00:00Z',relatorio_periodo_fim:'2026-11-15T02:59:59Z',saldo_referencia_em:null};renderCartoesFinanceiro()");
  assert.match(h.element('fin-mp-extra').textContent, /Relatório gerado em/);
  assert.match(h.element('fin-mp-extra').textContent, /instante exato do saldo não informado/);
  assert.doesNotMatch(h.element('fin-mp-extra').textContent, /15\/11/);
});

// Independent review regressions: these assert the required, trustworthy behavior.
test('unknown gateway net is never presented as a known liquid total', () => {
  const h = dashboardHarness();
  h.run("stripeRecebimentos=[{stripe_id:'ch_unknown',empresa_id:'clickdrop',status:'approved',valor:100,valor_liquido:null,taxa:null,moeda:'BRL',date_approved:'2026-11-14T12:00:00Z'}];stripeSaldoLoading=true;renderStripe()");
  assert.doesNotMatch(h.element('stripe-kpis').innerHTML, /Líquido[^<]*<[^>]*>[^<]*100,00/);
  assert.equal(h.run("getEmpresaMes('clickdrop','Nov').liquidoGateway"), null);
});

test('report preparing retains the last confirmed MP amount as stale', async () => {
  const h = dashboardHarness({ invoke: () => ({data:{ok:true,saldo_ok:false,saldo_erro:'preparando'},error:null}) });
  h.context.renderAll=()=>{};h.context.renderCartoesFinanceiro=()=>{};h.context.pintarCaixasAtuais=()=>{};
  h.run("mpSaldo={ok:true,saldo_ok:true,saldo:{available_balance:100},saldo_referencia_em:'2026-11-14T12:00:00Z'}");
  await h.run('carregarSaldoMP()');
  assert.equal(h.run('saldoDisponivelMercadoPago()'),100);
  assert.equal(h.run('mpSaldo.desatualizado'),true);
});

test('receipt reload traverses database pages before publishing complete totals', async () => {
  const all=Array.from({length:1001},(_,i)=>({id:'r'+i,stripe_id:'ch_'+i,empresa_id:'clickdrop',status:'approved',valor:1,valor_liquido:1,taxa:0,moeda:'BRL',date_approved:'2026-11-14T12:00:00Z'}));
  const h=dashboardHarness({query:call=>({data:call.table==='stripe_recebimentos'?all.slice(call.range?.[0]||0,(call.range?.[1]??999)+1):[],error:null})});
  h.context.renderAll=()=>{};
  await h.run('carregarRecebimentosStripe()');
  assert.equal(h.run('stripeRecebimentos.length'),1001);
});

test('stale available balances make forecasts explicitly incomplete',()=>{
  const h=dashboardHarness();
  h.run("mpSaldo={ok:true,saldo_ok:true,desatualizado:true,saldo:{available_balance:100}};stripeSaldo={ok:true,saldo_ok:true,saldo:{disponivel:0,a_liberar:0,moeda:'BRL'}}");
  assert.equal(h.context.DashboardFinance.forecast().incomplete,true);
});

test('an older receipt snapshot cannot erase a newer realtime insert',async()=>{
  let resolve;
  const h=dashboardHarness({query:()=>new Promise(r=>{resolve=r;})});
  h.context.renderAll=()=>{};
  h.run('iniciarRealtimeMP()');
  const loading=h.run('carregarRecebimentosMP()');
  await Promise.resolve();
  h.callbacks.get('mp_recebimentos')({eventType:'INSERT',new:{id:'new-row',mp_id:'new-payment',status:'approved',valor:10,moeda:'BRL'}});
  resolve({data:[],error:null,count:0});
  await loading;
  assert.equal(h.run("mpRecebimentos.some(r=>r.id==='new-row')"),true);
});
