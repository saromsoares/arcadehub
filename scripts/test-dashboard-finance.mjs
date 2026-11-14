import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardHarness } from './dashboard-test-harness.mjs';
function receipt(h, fields = '') {
  h.run(`stripeRecebimentos=[{id:'receipt-1',stripe_id:'ch_sale',empresa_id:'clickdrop',status:'approved',valor:99.90,valor_liquido:95.52,taxa:4.38,moeda:'BRL',date_approved:'2026-11-14T12:00:00Z',raw:{account_source:'clickdrop'},${fields}}]`);
}
test('ClickDrop gross, fee, net and result agree across summary and company form', () => {
  const h = dashboardHarness(); receipt(h);
  assert.equal(h.run("getEmpresaMes('clickdrop','Nov').receita"), 99.90);
  assert.equal(h.run("getEmpresaMes('clickdrop','Nov').custos"), 4.38);
  assert.equal(h.run("getEmpresaMes('clickdrop','Nov').resultado"), 95.52);
  h.run("selEmpresaMonth='Nov';currentEmpresaId='clickdrop';renderEmpresaIndividual('clickdrop')");
  assert.match(h.element('empresa-individual-content').innerHTML, /Custos Nov[\s\S]*?4,38/);
  h.run("selCompany='clickdrop';selMonth='Nov';updateLancResult()");
  assert.match(h.element('lanc-result-value').textContent, /95,52/);
  const form = h.run("buildEmpresaForm('clickdrop','Nov')");
  assert.match(form, /Receita bruta total/); assert.match(form, /99,90/); assert.match(form, /95,52/);
});
test('negative and zero result goals use favorable differences', () => {
  const h = dashboardHarness();
  h.run("planejado={'Nov:clickdrop':{custos_diretos_p:100}};lancamentos={'Nov:clickdrop':{custos_diretos:200}}");
  assert.equal(h.run("getCompaniesYTD().find(c=>c.id==='clickdrop').status"), 'VERMELHO');
  h.run("lancamentos={'Nov:clickdrop':{receita:100}}");
  assert.equal(h.run("getCompaniesYTD().find(c=>c.id==='clickdrop').status"), 'VERDE');
  assert.equal(h.context.DashboardFinance.favorableStatus(-1, 0, true), 'VERMELHO');
  assert.equal(h.context.DashboardFinance.favorableStatus(0, 0, false), 'SEM DADOS');
});
test('future December stays outside current YTD and comparison totals', () => {
  const h = dashboardHarness(); h.run("lancamentos={'Dez:clickdrop':{receita:100}};planejado={'Dez:clickdrop':{receita_p:200}}");
  assert.equal(h.run("getEmpresaYTD('clickdrop').receita"), 0);
  assert.equal(h.run('getYTD(getConsolidado()).receitaP'), 0);
  h.run('renderComparativo(getConsolidado(),getYTD(getConsolidado()),getCompaniesYTD())');
  assert.match(h.element('comp-table').innerHTML, /Fora do acumulado corrente/);
});
test('legacy expense is recognized in DRE, consumption and theoretical cash', () => {
  const h = dashboardHarness(); h.run("estrutura.aportes.SAROM.Mar=1000;lancamentos={'Nov:clickdrop':{custos_diretos:100}}");
  assert.equal(h.run('getTotals().totalRealizadoAcum'), 100);
  assert.equal(h.run('getTotals().caixaAtual'), 900);
  assert.equal(h.run('getTotals().burnRate'), 100);
});
test('a taxed gateway aporte preserves equity gross while cash receives net', () => {
  const h = dashboardHarness(); receipt(h, "empresa_id:'aporte:SAROM',valor:100,valor_liquido:96,taxa:4");
  assert.equal(h.run('getTotals().totalAportes'), 100);
  assert.equal(h.run('getTotals().aportesLiquidos'), 96);
  assert.equal(h.run('getTotals().caixaAtual'), 96);
});
test('explicit exact manual fee reference prevents double deduction; mismatch is flagged', () => {
  const h = dashboardHarness(); receipt(h);
  h.run("custosExtras=[{id:'cost',empresa_id:'clickdrop',mes:'Nov',categoria:'Taxas de pagamento',valor:4.38,gateway_receipt_ref:'stripe:ch_sale'}]");
  assert.equal(h.run("getEmpresaMes('clickdrop','Nov').custos"), 4.38);
  assert.equal(h.run('getTotals().caixaAtual'), 95.52);
  h.run('custosExtras[0].valor=5');
  assert.equal(h.run("getEmpresaMes('clickdrop','Nov').custos"), 9.38);
  assert.ok(h.context.DashboardFinance.financialInsights().some(x => /Vínculos de taxa/.test(x.title)));
});
test('USD and BRL are never aggregated or formatted as the same currency', () => {
  const h = dashboardHarness(); receipt(h, 'valor:100,valor_liquido:96,taxa:4');
  h.run("stripeRecebimentos.push({...stripeRecebimentos[0],id:'usd',stripe_id:'ch_usd',moeda:'USD'}) ;stripeSaldo={ok:false};stripeSaldoLoading=true;renderStripe()");
  assert.equal(h.run("getEmpresaMes('clickdrop','Nov').receita"), 100);
  assert.match(h.element('stripe-kpis').innerHTML, /USD/); assert.match(h.element('stripe-kpis').innerHTML, /BRL/);
  assert.doesNotMatch(h.element('stripe-kpis').innerHTML, /192,00/);
});
test('unclassified queue uses approved permitted receipts and cannot leak blocked providers', () => {
  const h = dashboardHarness(); receipt(h, "empresa_id:null");
  assert.equal(h.context.getPendingReceipts().length, 1);
  h.run("paginasBloqueadas=new Set(['stripe'])");
  assert.equal(h.context.getPendingReceipts().length, 0);
});
test('forecast keeps pending and Nubank outside available; known dates are identified', () => {
  const h = dashboardHarness(); receipt(h, "raw:{balance_status:'pending',available_on:'2026-12-14T00:00:00Z'}");
  h.context.saldoDisponivelMercadoPago = () => 100;
  h.context.saldoDisponivelStripe = () => -0.28;
  h.run("mpSaldo={ok:true,saldo_ok:true,saldo:{available_balance:100,unavailable_balance:0}};stripeSaldo={ok:true,saldo_ok:true,saldo:{disponivel:-0.28,a_liberar:95.52,moeda:'BRL'}};nuSaldo={ok:true,saldo:{disponivel:9000}};");
  const value = h.context.DashboardFinance.forecast();
  assert.equal(value.available, 99.72); assert.equal(value.pending, 95.52); assert.equal(value.knownNet, 95.52);
  assert.ok(value.scenarios.every(s => s.after30 <= 99.72));
});
test('old MP balance response after reset cannot repopulate new session', async () => {
  let resolve;
  const h = dashboardHarness({ invoke: () => new Promise(r => { resolve = r; }) });
  h.context.renderCartoesFinanceiro = () => {}; h.context.pintarCaixasAtuais = () => {};
  h.context.resetEmailState = () => {}; h.context.renderSaldoNubank = () => {};
  const request = h.run('carregarSaldoMP()');
  h.run('painelEpoch++'); await h.run('resetState()');
  resolve({ data: { ok: true, saldo_ok: true, saldo: { available_balance: 1234.56 } }, error: null });
  await request;
  assert.equal(h.run('mpSaldo'), null);
});
test('MP realtime updates receipts and financial views while respecting session epoch', () => {
  const h = dashboardHarness(); let renders = 0; h.context.renderAll = () => { renders++; };
  h.run('iniciarRealtimeMP()');
  const fn = h.callbacks.get('mp_recebimentos');
  fn({ eventType: 'INSERT', new: { id: 'mp-real', status: 'approved', valor: 1 } });
  [...h.timers.values()].at(-1)();
  assert.equal(renders, 1);
  h.run('painelEpoch++'); fn({ eventType: 'INSERT', new: { id: 'stale' } });
  assert.equal(h.run("mpRecebimentos.some(r=>r.id==='stale')"), false);
});
test('new fiscal year includes January and does not mix prior-year receipts', () => {
  const h = dashboardHarness({ now: '2027-01-15T12:00:00Z' });
  h.run("lancamentos={'Jan:clickdrop':{receita:50},'Mar:clickdrop':{receita:100}};stripeRecebimentos=[{empresa_id:'clickdrop',status:'approved',valor:99.9,moeda:'BRL',date_created:'2026-11-14T12:00:00Z'}]");
  assert.equal(h.run('DATA_INICIO.mes'), 'Jan');
  assert.equal(h.run("getEmpresaYTD('clickdrop').receita"), 50);
});
test('refund never implies a refunded processing fee or a known post-refund net', () => {
  const h = dashboardHarness(); receipt(h, "status:'refunded',valor:0,valor_liquido:null,taxa:4,raw:{financial_review:'refund_settlement_unconfirmed'}");
  assert.equal(h.run("getEmpresaMes('clickdrop','Nov').receita"), 0);
  assert.equal(h.run("getEmpresaMes('clickdrop','Nov').custos"), 4);
  assert.equal(h.run("getEmpresaMes('clickdrop','Nov').resultadoProvisorio"), true);
});

test('Stripe movements explain signed fees and preserve provider restrictions', () => {
  const h = dashboardHarness();
  h.run("stripeSaldo={ok:true,saldo_ok:true,saldo:{disponivel:-0.28,a_liberar:95.52},movimentos:[{conta_id:'arcade_hub',tipo:'stripe_fee',valor:-0.14,taxa:0,liquido:-0.14,moeda:'BRL',status:'available',data:'2026-11-14T12:00:00Z'}]};renderCartoesFinanceiro()");
  const markup = h.element('financeiro-inteligencia').innerHTML;
  assert.match(markup, /cobertura parcial/); assert.match(markup, /Taxa Stripe/); assert.match(markup, /-R\$\s*0,14/);
  h.run("paginasBloqueadas=new Set(['stripe']);renderCartoesFinanceiro()");
  assert.doesNotMatch(h.element('financeiro-inteligencia').innerHTML, /Taxa Stripe/);
});

test('annual charts show future plans while excluding future realized entries', () => {
  const h = dashboardHarness();
  h.run("lancamentos={'Nov:clickdrop':{receita:10},'Dez:clickdrop':{receita:900}};planejado={'Dez:clickdrop':{receita_p:100}};renderComparativo(getConsolidado(),getYTD(getConsolidado()),getCompaniesYTD())");
  assert.equal(h.run("chartComp.data.datasets[0].data[11]"), null);
  assert.equal(h.run("chartComp.data.datasets[1].data[11]"), 100);
});

test('cost and revenue change explanations reconcile all project drivers', () => {
  const h = dashboardHarness();
  h.run("lancamentos={'Nov:clickdrop':{receita:200,custos_diretos:60},'Out:clickdrop':{receita:100,custos_diretos:10},'Nov:arcade_hub':{receita:50,custos_diretos:20},'Out:arcade_hub':{receita:50,custos_diretos:10}}");
  const alerts = h.context.dashboardFinancialInsights();
  const costs = alerts.find(a => a.title.includes('valores de custos'));
  const revenue = alerts.find(a => a.title.includes('valores de receita'));
  assert.match(costs.detail, /Variação total: \+R\$\s*60,00/);
  assert.match(costs.detail, /ClickDrop: \+R\$\s*50,00/);
  assert.match(revenue.detail, /Variação total: \+R\$\s*100,00/);
});
