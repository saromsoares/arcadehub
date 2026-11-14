// Regression smoke against the published script order; no network or browser.
import assert from 'node:assert/strict';
import { dashboardHarness } from './dashboard-test-harness.mjs';
const h = dashboardHarness({ modules: ['dashboard-security.js', 'dashboard-finance.js', 'dashboard-operations.js'] });
h.run(`stripeSaldo={ok:true,saldo_ok:true,parcial:false,conta:{nome:'ARCADE HUB TECH + ClickDrop'},
  saldo:{disponivel:-0.28,a_liberar:114.38,total:114.10,moeda:'BRL'},
  contas:[{nome:'ARCADE HUB TECH',ok:true,saldo:{disponivel:-0.28,a_liberar:18.86}},
          {nome:'ClickDrop',ok:true,saldo:{disponivel:0,a_liberar:95.52}}]};
  stripeSaldoLoading=true;
  stripeRecebimentos=[{id:'fixture',status:'approved',empresa_id:'clickdrop',valor:99.90,
    valor_liquido:95.52,taxa:4.38,moeda:'BRL',date_approved:EXERCICIO+'-11-14T12:00:00Z',
    raw:{account_source:'clickdrop'},descricao:'Fixture'}];`);
assert.equal(h.run("getStripeReceita('Nov','clickdrop')"), 99.90);
assert.equal(h.run("getStripeReceita('Nov','arcade_hub')"), 0);
assert.equal(h.run("getEmpresaMes('clickdrop','Nov').resultado"), 95.52);
assert.equal(h.run('saldoDisponivelStripe()'), -0.28);
h.context.saldoDisponivelMercadoPago = () => 100;
assert.equal(h.run('estadoCaixaSaldos().valor'), 99.72);
h.run('renderStripe()');
const table = h.element('stripe-receb-body').innerHTML;
assert.match(table, /Conta ClickDrop/);
for (const amount of ['99,90', '4,38', '95,52']) assert.ok(table.includes(amount));
h.run("paginasBloqueadas=new Set(['stripe'])");
assert.equal(h.context.getPendingReceipts().length, 0);
await h.run('carregarRecebimentosStripe()');
assert.equal(h.calls.filter(c => c.table === 'stripe_recebimentos').length, 0);
console.log('Dashboard Stripe PASS; all three modules, DOM/SDK fixtures, no browser/network.');
