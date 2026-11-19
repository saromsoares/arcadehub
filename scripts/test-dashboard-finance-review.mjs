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
  h.run("stripeRecebimentos=[{stripe_id:'ch_unknown',empresa_id:'clickdrop',status:'approved',valor:100,valor_liquido:null,taxa:null,moeda:'BRL',date_approved:'2026-11-14T12:00:00Z'}];stripeSaldoLoading=true;renderCartoesFinanceiro()");
  assert.doesNotMatch(h.element('stripe-kpis').innerHTML, /Líquido[^<]*<[^>]*>[^<]*100,00/);
  assert.equal(h.run("getEmpresaMes('clickdrop','Nov').liquidoGateway"), null);
});

test('the Stripe shortcut clears conflicting filters and includes older payments', () => {
  const h = dashboardHarness();
  h.run(`stripeRecebimentos=[{id:'st',stripe_id:'ch_old',empresa_id:'clickdrop',status:'approved',valor:10,date_created:'2025-12-01T12:00:00Z'}];
    mpRecebimentos=[{id:'mp',mp_payment_id:321,status:'approved',valor:20,date_created:'2026-11-14T12:00:00Z'}];renderCartoesFinanceiro()`);
  const search = h.element('fin-receipt-search');
  search.value = 'inexistente';
  h.events.get('document:input')({ target: search });
  h.events.get('document:click')({ target: { closest: selector => selector === '[data-finance-provider]' ? { dataset: { financeProvider: 'stripe' } } : null } });
  assert.equal(search.value, '');
  assert.equal(h.element('fin-receipt-provider').value, 'stripe');
  assert.equal(h.element('fin-receipt-period').value, 'all');
  assert.match(h.element('fin-receipt-list').innerHTML, /ch_old/);
  assert.doesNotMatch(h.element('fin-receipt-list').innerHTML, /Mercado Pago/);
});

test('Stripe receipt failures appear separately from a successful balance and recover on retry', async () => {
  let unavailable = true;
  const h = dashboardHarness({
    query: call => call.table === 'stripe_recebimentos' && unavailable ? { error: { message: 'offline' } } : { data: [] },
    invoke: () => ({ data: { ok: true, saldo_ok: true, saldo: { disponivel: 1, a_liberar: 2 } } }),
  });
  h.context.renderAll = () => h.run('renderCartoesFinanceiro()');
  assert.equal(await h.context.DashboardFinance.reloadReceipts('stripe'), false);
  await h.run('carregarSaldoStripe()');
  assert.equal(h.run('saldoDisponivelStripe()'), 1);
  assert.match(h.element('fin-receipt-summary').innerHTML, /Falha ao consultar recebimentos de Stripe/);
  assert.match(h.element('fin-receipt-list').innerHTML, /consulta incompleta/);
  unavailable = false;
  assert.equal(await h.context.DashboardFinance.reloadReceipts('stripe'), true);
  assert.doesNotMatch(h.element('fin-receipt-summary').innerHTML, /Falha/);
  assert.match(h.element('fin-receipt-list').innerHTML, /Nenhum pagamento corresponde/);
});

test('Stripe account errors from a failed balance request remain visible in the card', async () => {
  const h = dashboardHarness({ invoke: () => ({ error: { context: { status: 502, json: async () => ({
    ok: false, error: 'Consulta Stripe indisponível', contas: [{ id: 'clickdrop', ok: false, error: 'Consulta recusada' }],
  }) } } }) });
  await h.run('carregarSaldoStripe()');
  assert.equal(h.element('fin-stripe-sub').textContent, 'Consulta Stripe indisponível');
  assert.match(h.element('fin-stripe-contas').innerHTML, /Stripe ClickDrop[\s\S]+Consulta recusada/);
  assert.equal(h.run('saldoDisponivelStripe()'), null);
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

test('cash uses available BRL even when Mercado Pago returns only combined amounts', () => {
  const h = dashboardHarness();
  h.run("mpSaldo={ok:true,saldo_ok:true,saldo:{total_amount:150,unavailable_balance:70}};stripeSaldo={ok:true,saldo_ok:true,saldo:{disponivel:-2,a_liberar:20,moeda:'BRL'}}");
  assert.equal(h.run('saldoDisponivelMercadoPago()'), null);
  assert.equal(h.run('estadoCaixaSaldos().valor'), -2);
  assert.equal(h.run('estadoCartaoMercadoPago().valor'), '—');
});

test('gateway dates follow São Paulo and legacy cost categories remain in the cash totals', () => {
  const h = dashboardHarness({ now: '2027-01-01T01:00:00Z' });
  h.run(`lancamentos={'Dez:clickdrop':{custos_diretos:'2.00',folha:'3.00'}};
    mpRecebimentos=[{id:'internal-id',mp_payment_id:7123,status:'approved',empresa_id:'clickdrop',valor:10,taxa:1,valor_liquido:9,date_approved:'2027-01-01T01:00:00Z'}];
    custosExtras=[{mes:'Dez',empresa_id:'clickdrop',categoria:'Categoria anterior',valor:'4.00',gateway_receipt_ref:null}];`);
  assert.equal(h.run('EXERCICIO'), 2026);
  assert.equal(h.run("getEmpresaMes('clickdrop','Dez').resultado"), 0);
  assert.equal(h.run("getRealizadoCustoMes('Dez','Outros Custos')"), 9);
  assert.equal(h.run("getTotals().totalRealizadoAcum"), 10);
  assert.equal(h.run('DashboardFinance.receipts()[0].externalId'), '7123');
  assert.equal(h.run('DashboardFinance.receipts()[0].ref'), 'mp:internal-id');
});

test('planning comparisons use the same projects and months while actual totals retain broader coverage', () => {
  const h = dashboardHarness();
  h.run(`lancamentos={'Nov:clickdrop':{receita:50,custos_diretos:35},'Out:clickdrop':{receita:150},'Nov:priva_br':{receita:500,custos_diretos:80}};
    planejado={'Nov:clickdrop':{receita_p:'100.00',custos_diretos_p:'50.00',folha_p:'10.00'}};`);
  const ytd = h.run('getYTD(getConsolidado())');
  assert.equal(ytd.receita, 700);
  assert.equal(ytd.receitaComparavel, 50);
  assert.equal(ytd.custosComparaveis, 35);
  assert.equal(ytd.custosP, 60);
  assert.equal(h.run("getCompaniesYTD().find(x=>x.id==='clickdrop').atR"), 0.5);
  assert.equal(h.run("getCompaniesYTD().find(x=>x.id==='clickdrop').resultadoDelta"), -25);
});

test('payment filters can find the provider ID, retain unknown amounts and hide blocked providers', () => {
  const h = dashboardHarness();
  h.run(`mpRecebimentos=[{id:'mp-row',mp_payment_id:991234,status:'approved',empresa_id:null,descricao:'Ação promocional',valor:12,moeda:'BRL',date_approved:'2026-11-03T15:00:00Z'}];
    stripeRecebimentos=[{id:'stripe-row',stripe_id:'ch_usd',status:'approved',empresa_id:'clickdrop',valor:20,taxa:2,valor_liquido:18,moeda:'USD',date_approved:'2026-11-04T15:00:00Z'}];
    renderCartoesFinanceiro();`);
  const list = h.element('fin-receipt-list'), summary = h.element('fin-receipt-summary');
  assert.match(summary.innerHTML, /USD/);
  assert.match(summary.innerHTML, /1 sem vínculo/);
  h.events.get('document:input')({ target: { id: 'fin-receipt-search', value: 'acao 991234' } });
  assert.match(list.innerHTML, /991234/);
  assert.match(list.innerHTML, /Valores incompletos/);
  assert.doesNotMatch(list.innerHTML, /ch_usd/);
  h.run("paginasBloqueadas=new Set(['mercadopago','stripe']);renderCartoesFinanceiro()");
  assert.equal(h.element('financeiro-inteligencia').hidden, true);
  assert.equal(list.innerHTML, '');
});

test('receipt assignment guards against another user changing the destination and confirms removal', async () => {
  const modules = ['dashboard-security.js', 'dashboard-finance.js'];
  let database = { id: 'row', empresa_id: 'jogadaca' };
  const h = dashboardHarness({ modules, query(call) {
    if (call.method === 'UPDATE') {
      if (call.filters.find(([name]) => name === 'empresa_id')[1] !== database.empresa_id) return { data: null, error: null };
      database = { ...database, ...call.payload }; return { data: database, error: null };
    }
    return { data: [database], error: null, count: 1 };
  } });
  h.context.renderAll = () => {};
  h.run("mpRecebimentos=[{id:'row',empresa_id:'priva_br'}]");
  assert.equal(await h.run("atribuirEmpresaMP('row','clickdrop')"), false);
  assert.equal(h.run('mpRecebimentos[0].empresa_id'), 'jogadaca');
  assert.equal(await h.run("atribuirEmpresaMP('row','')"), true);
  assert.equal(h.run('DashboardFinance.receipts()[0].company'), '');
  assert.equal(database.empresa_id, null);
  assert.equal(await h.run("atribuirEmpresaMP('row','clickdrop')"), true);
  assert.equal(database.empresa_id, 'clickdrop');
});

test('realtime deletes use the old record when Supabase supplies an empty new object', () => {
  const h = dashboardHarness();
  h.run("mpRecebimentos=[{id:'deleted',empresa_id:'clickdrop'}];iniciarRealtimeMP()");
  h.callbacks.get('mp_recebimentos')({ eventType: 'DELETE', new: {}, old: { id: 'deleted' } });
  assert.equal(h.run('mpRecebimentos.length'), 0);
});
