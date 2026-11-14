// Regression smoke against the published script order; no network or browser.
import assert from 'node:assert/strict';
import { dashboardHarness } from './dashboard-test-harness.mjs';
const h = dashboardHarness({ modules: ['dashboard-security.js', 'dashboard-finance.js', 'dashboard-operations.js'] });
h.run(`stripeSaldo={ok:true,saldo_ok:true,parcial:false,conta:{nome:'ARCADE HUB TECH + ClickDrop'},
  saldo:{disponivel:-0.28,a_liberar:114.38,total:114.10,moeda:'BRL'},
  contas:[{id:'arcade_hub',nome:'ARCADE HUB TECH',ok:true,saldo:{disponivel:-0.28,a_liberar:18.86,total:18.58,moeda:'BRL'}},
          {id:'clickdrop',nome:'ClickDrop',ok:true,saldo:{disponivel:0,a_liberar:95.52,total:95.52,moeda:'BRL'}}]};
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
h.run('renderCartoesFinanceiro()');
assert.equal(h.run('estadoCartaoStripe().valor'), h.run('fmt(114.10)'));
const accounts = h.element('fin-stripe-contas').innerHTML;
assert.match(accounts, /Stripe Geral[\s\S]*18,58/);
assert.match(accounts, /Stripe ClickDrop[\s\S]*95,52/);
assert.match(h.run('estadoCartaoStripe().extra'), /Apenas o disponível entra no Caixa Atual/);
h.run('stripeSaldo.parcial=true;stripeSaldo.contas[1].ok=false;stripeSaldo.saldo={disponivel:-0.28,a_liberar:18.86,total:18.58,moeda:"BRL"};renderCartoesFinanceiro()');
assert.match(h.run('estadoCartaoStripe().sub'), /Soma parcial/);
assert.equal(h.run('estadoCartaoStripe().valor'), h.run('fmt(18.58)'));
assert.match(h.element('fin-stripe-contas').innerHTML, /Stripe ClickDrop[\s\S]*Sem leitura/);
h.run('stripeSaldo.parcial=false;stripeSaldo.contas[1].ok=true');
h.run('renderStripe()');
const table = h.element('stripe-receb-body').innerHTML;
assert.match(table, /Conta ClickDrop/);
for (const amount of ['99,90', '4,38', '95,52']) assert.ok(table.includes(amount));
h.run("paginasBloqueadas=new Set(['stripe'])");
h.run('renderCartoesFinanceiro()');
assert.equal(h.element('fin-stripe-contas').innerHTML, '');
assert.equal(h.element('fin-stripe-contas').hidden, true);
assert.equal(h.context.getPendingReceipts().length, 0);
await h.run('carregarRecebimentosStripe()');
assert.equal(h.calls.filter(c => c.table === 'stripe_recebimentos').length, 0);
console.log('Dashboard Stripe PASS; all three modules, DOM/SDK fixtures, no browser/network.');
