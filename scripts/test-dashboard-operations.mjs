// Regression tests execute the real inline dashboard and classic modules with deterministic HTTP/DOM fixtures.
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
const html = readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');
const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
const elements = new Map(), checks = [], storage = new Map(), authCallbacks = [];
const persist = [], calls = [], apiCalls = [];
let resultMode = 'fail', interruptInsert = null, interruptUpsert = null, apiResponder = () => ({ ok: true }), readFailure = null;
let savedCount = 0;
class Element {
  constructor(id = '') {
    this.id = id; this.value = ''; this.style = {}; this.dataset = {}; this.listeners = new Map(); this.children = [];
    this.classList = { contains: () => false, add() {}, remove() {}, toggle() {} }; this.options = []; this.textContent = '';
  }
  set innerHTML(value) {
    this._html = value;
    for (const match of value.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/gi)) {
      const element = new Element(match[2]);
      element.value = (match[0].match(/\bvalue="([^"]*)"/) || [])[1] || '';
      if (/display:none/.test(match[0])) element.style.display = 'none';
      element.parentNode = this; elements.set(match[2], element);
    }
  }
  get innerHTML() { return this._html || ''; }
  setAttribute(name, value) { this[name] = value; }
  getAttribute(name) { return this[name] || ''; }
  removeAttribute(name) { delete this[name]; }
  appendChild(child) { child.parentNode = this; this.children.push(child); if (child.id) elements.set(child.id, child); return child; }
  insertBefore(child) { return this.appendChild(child); }
  remove() { elements.delete(this.id); }
  replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); }
  addEventListener(type, handler) { const handlers = this.listeners.get(type) || []; handlers.push(handler); this.listeners.set(type, handlers); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== handler)); }
  querySelector() { return null; }
  querySelectorAll(selector) {
    if (selector.includes('input[id]') && this.id === 'lanc-custo-extra-form') return [...elements.values()].filter(item => /^ce-/.test(item.id));
    if (selector.includes('input[id]') && this.id === 'plano-form') return [...elements.values()].filter(item => /^plano-/.test(item.id));
    if (selector.includes('input[id]') && this.id === 'lanc-form') return [...elements.values()].filter(item => /^lanc-(receita|headcount|obs)$/.test(item.id));
    if (selector === 'input[oninput]' && this.id === 'plan-table') return [...elements.values()].filter(item => /^fixture-plan-/.test(item.id));
    return [];
  }
  checkValidity() { return true; }
  contains() { return false; }
  focus() {} scrollIntoView() {} setSelectionRange() {} reset() {}
}
for (const match of html.matchAll(/\bid="([^"]+)"/g)) if (!elements.has(match[1])) elements.set(match[1], new Element(match[1]));
const element = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
class Query {
  constructor(table) { this.table = table; this.filters = []; this.kind = 'get'; }
  insert(payload) { this.kind = 'insert'; this.payload = payload; return this; }
  upsert(payload) { this.kind = 'upsert'; this.payload = payload; return this; }
  update(payload) { this.kind = 'update'; this.payload = payload; return this; }
  delete() { this.kind = 'delete'; return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  select(columns) { this.columns = columns; return this; } order() { return this; } limit() { return this; } in() { return this; }
  single() { this.one = true; return this; }
  async execute() {
    calls.push({ table: this.table, kind: this.kind, payload: this.payload, filters: this.filters });
    if (this.kind === 'get') return readFailure?.(this) || { data: persist.filter(row => this.filters.every(([key, value]) => row[key] === value)), error: null };
    if (interruptInsert && this.kind === 'insert') { const handler = interruptInsert; interruptInsert = null; await handler(this); }
    if (interruptUpsert && this.kind === 'upsert') { const handler = interruptUpsert; interruptUpsert = null; await handler(this); }
    if (resultMode === 'fail') return { data: null, error: { message: 'synthetic database failure' } };
    if (this.kind === 'insert') {
      const row = { ...this.payload, id: webcrypto.randomUUID() }; persist.push(row); return { data: row, error: null };
    }
    const row = { id: this.filters.find(([key]) => key === 'id')?.[1] || 'saved', ...this.payload };
    return { data: this.one ? row : [row], error: null };
  }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}
const sdk = {
  auth: { onAuthStateChange(callback) { authCallbacks.push(callback); }, getSession: async () => ({ data: { session: null } }) },
  from: table => new Query(table), functions: { invoke: async (name, args) => {
    apiCalls.push({ name, body: args?.body }); const data = await apiResponder(name, args?.body); return { data, error: null };
  } },
  removeAllChannels: async () => {}, channel: () => ({ on() { return this; }, subscribe() { return this; } }),
};
const quietConsole = { ...console, error() {} };
const context = vm.createContext({ console: quietConsole, URL, Date, Intl, Set, Map, Promise, TextEncoder, crypto: webcrypto,
  location: { hash: '' }, supabase: { createClient: () => sdk },
  document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => new Element(), createElement: () => new Element(), getElementById: id => elements.get(id) || null },
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, confirm: () => true, prompt: () => null, alert() {},
  sessionStorage: { get length() { return storage.size; }, key: index => [...storage.keys()][index], getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
});
context.window = context;
new vm.Script(inline, { filename: 'admin-inline.js' }).runInContext(context);
for (const name of ['dashboard-security.js', 'dashboard-finance.js', 'dashboard-operations.js']) {
  if (name === 'dashboard-operations.js') new vm.Script('const operationsPreviousLoadFixture=loadAll;loadAll=async epoch=>window.operationsLoadFixture?window.operationsLoadFixture(epoch):operationsPreviousLoadFixture(epoch)').runInContext(context);
  const path = new URL('../admin/' + name, import.meta.url); if (existsSync(path)) new vm.Script(readFileSync(path, 'utf8'), { filename: name }).runInContext(context);
}
const run = code => vm.runInContext(code, context);
context.toast = () => {}; context.showSaving = () => savedCount++;
context.renderSaldoNubank = () => {}; context.renderCalendario = () => {};
context.renderAll = () => {}; context.renderLeads = () => {}; context.renderBalancoSocios = () => {};
for (const [id, value] of Object.entries({ 'ce-categoria': 'Outros Custos', 'ce-tipo': 'variavel', 'ce-descricao': 'Fixture cost', 'ce-valor': '123.45', 'ce-pagador': 'EMPRESA', 'ce-meio': 'pix' })) element(id).value = value;
element('lanc-custo-extra-form').style.display = 'block';
await assert.rejects(run("saveCustoExtra({mes:'Nov',empresa_id:'clickdrop',descricao:'Fixture',valor:123.45})"));
assert.equal(savedCount, 0); checks.push('cost INSERT failure never reports saved');
await run('salvarCustoExtra()');
assert.equal(run('custosExtras.length'), 0); assert.equal(element('lanc-custo-extra-form').style.display, 'block');
assert.equal(element('ce-descricao').value, 'Fixture cost'); checks.push('failed cost retains draft without ghost expense');
resultMode = 'ok';
await run('salvarCustoExtra()'); assert.equal(run('custosExtras.length'), 1); assert.ok(run('custosExtras[0].id'));
checks.push('confirmed cost contains server ID');
run("document.getElementById('lanc-custo-extra-form').dataset.editId=custosExtras[0].id");
await run('salvarELancarOutro()');
assert.equal(element('lanc-custo-extra-form').dataset.editId, undefined);
element('ce-descricao').value = 'Next independent fixture'; element('ce-valor').value = '25';
await run('salvarCustoExtra()'); assert.equal(calls.at(-1).kind, 'insert');
assert.equal(run('custosExtras.length'), 2); checks.push('save and add another exits edit mode and creates an independent next cost');
persist.length = 0; run("custosExtras=[];selCompany='clickdrop';delete document.getElementById('lanc-custo-extra-form').dataset.recorrenciaId");
interruptInsert = async () => { run("selCompany='priva_br'"); };
await run("criarCustoFixoRecorrente({descricao:'Recurring fixture',categoria:'Outros Custos',valor:100},'Out','clickdrop')");
assert.ok(persist.length >= 2); assert.ok(persist.every(cost => cost.empresa_id === 'clickdrop'));
const recurringCount = persist.length;
await run("criarCustoFixoRecorrente({descricao:'Recurring fixture',categoria:'Outros Custos',valor:100},'Out','clickdrop')");
assert.equal(persist.length, recurringCount); checks.push('recurrence snapshots company and replay skips confirmed months');
resultMode = 'fail'; run("acoesCal=[{id:'calendar_fixture',data:'2026-11-14'}];calDraggingId='calendar_fixture'");
context.eventFixture = { preventDefault() {} }; await run("calDrop(eventFixture,'2026-11-20')");
assert.equal(run('acoesCal[0].data'), '2026-11-14'); checks.push('calendar drag failure keeps confirmed date');
for (const [id, value] of Object.entries({ 'cal-modal-id': '', 'cal-modal-data': '2026-11-14', 'cal-modal-titulo': 'Fixture action', 'cal-modal-descricao': 'Fixture details', 'cal-modal-status': 'todo', 'cal-modal-dias': '1' })) element(id).value = value;
let closes = 0; context.closeCalModal = () => closes++; await run('saveCalModal()');
assert.equal(closes, 0); assert.equal(element('cal-modal-titulo').value, 'Fixture action'); checks.push('calendar save failure keeps modal and draft');
await run("deleteCalAcao('calendar_fixture')"); assert.equal(run('acoesCal.length'), 1);
run("planosEmpresas=[{id:'plan_delete_fixture',empresa_id:'clickdrop'}];contatos=[{id:'contact_delete_fixture'}]");
await run("excluirPlano('clickdrop','plan_delete_fixture')"); await run("excluirContato('contact_delete_fixture')");
assert.equal(run('planosEmpresas.length'), 1); assert.equal(run('contatos.length'), 1); checks.push('failed calendar, plan and contact deletion keep confirmed records and report recoverable error');
run("currentEmpresaId='clickdrop';selCompany='clickdrop';selMonth='Nov'");
const form = element('lanc-custo-extra-form'); form.style.display = 'block'; form.dataset.opsScope = 'clickdrop:Nov';
element('ce-descricao').value = 'Unsent cost';
run("preservarRascunhosDashboard(()=>{document.getElementById('lanc-custo-extra-form').style.display='none';document.getElementById('ce-descricao').value='';})");
assert.equal(form.style.display, 'block'); assert.equal(element('ce-descricao').value, 'Unsent cost'); checks.push('financial repaint preserves visible contextual cost draft');
run("preservarRascunhosDashboard(()=>{selCompany='priva_br';document.getElementById('lanc-custo-extra-form').style.display='none';})");
assert.equal(form.style.display, 'none'); checks.push('draft is not restored into another project');
run("leads=[{id:'lead_a',empresa_id:'clickdrop',email:'ANA@EXAMPLE.TEST',telefone:'(11) 99999-8888',status:'novo'}]");
assert.equal(run("DashboardOperations.leadDuplicates({empresa_id:'clickdrop',email:'ana@example.test'}).length"), 1);
assert.equal(run("DashboardOperations.leadDuplicates({empresa_id:'priva_br',email:'ana@example.test'}).length"), 0);
assert.equal(run("DashboardOperations.leadDuplicates({empresa_id:'clickdrop',telefone:'11 99999-8888'}).length"), 1);
assert.equal(run("DashboardOperations.leadDuplicates({empresa_id:'clickdrop',telefone:'+55 11 99999-8888'}).length"), 0);
checks.push('lead duplicates normalize email and phone inside same project');
run("selLeadCompany='clickdrop';empresasAcessiveis=new Set(['clickdrop','arcade_hub']);leads=[{id:'lead_a',empresa_id:'clickdrop',status:'novo',proxima_acao:'Call',proxima_acao_em:'2026-11-01T12:00:00Z',responsavel:'Fixture',updated_at:'2026-11-01T12:00:00Z'}]");
const leadWork = run("DashboardOperations.leadWorkSummary(new Date('2026-11-14T12:00:00Z'))");
assert.equal(leadWork.overdue, 1); assert.equal(leadWork.stale, 1); checks.push('lead next-action and inactivity indicators use real dates');
for (const [id, value] of Object.entries({ 'lead-nome': 'Fixture lead', 'lead-email': 'unique@example.test', 'lead-regiao': 'Fixture region', 'lead-telefone': '11912345678', 'lead-observacao': 'Fixture notes', 'lead-status': 'novo', 'lead-responsavel': 'Fixture owner', 'lead-proxima-acao': 'Review fixture proposal', 'lead-proxima-acao-em': '2026-11-20T10:00' })) element(id).value = value;
run("selLeadCompany='clickdrop';leadEditId=null;leadSalvando=false");
apiResponder = () => ({ ok: false, error: 'Synthetic server failure' });
const leadEvent = { preventDefault() {}, submitter: new Element() }; context.leadEvent = leadEvent;
const previousLeads = run('leads.length');
await run('salvarLead(leadEvent)');
assert.equal(run('leads.length'), previousLeads); assert.equal(element('lead-nome').value, 'Fixture lead');
const failedRequest = apiCalls.at(-1).body;
assert.equal(failedRequest.action, 'save_lead'); assert.equal(failedRequest.lead.responsavel, 'Fixture owner');
assert.equal(failedRequest.lead.proxima_acao, 'Review fixture proposal'); assert.match(failedRequest.request_id, /^[a-f0-9-]{36}$/i);
apiResponder = (_name, body) => ({ ok: true, lead: { ...body.lead, id: 'confirmed_lead' } });
await run('salvarLead(leadEvent)'); assert.equal(apiCalls.at(-1).body.request_id, failedRequest.request_id);
assert.equal(run("leads.filter(lead=>lead.id==='confirmed_lead').length"), 1);
checks.push('lead save preserves rejected draft and reuses request identity until confirmed');
element('contatos-list').parentNode = element('contact-parent');
run("contatos=[{id:'contact_fixture',projeto:'ClickDrop',nome:'Contact fixture',email:'contact@example.test',whatsapp:'11922334455',mensagem:'Synthetic contact'}];leads=[]");
run("DashboardOperations.reviewContact('contact_fixture')");
assert.equal(element('ops-contact-project').value, 'clickdrop'); assert.equal(element('ops-contact-name').value, 'Contact fixture');
apiResponder = (_name, body) => ({ ok: true, lead: { ...body.lead, id: 'contact_lead', contato_origem_id: body.contato_id } });
await element('ops-contact-review').listeners.get('submit')[0]({ preventDefault() {} });
assert.equal(apiCalls.at(-1).body.action, 'convert_contact'); assert.equal(apiCalls.at(-1).body.contato_id, 'contact_fixture');
assert.equal(run("leads.filter(lead=>lead.contato_origem_id==='contact_fixture').length"), 1);
context.showTab = () => {};
const contactCalls = apiCalls.length; run("DashboardOperations.reviewContact('contact_fixture')");
assert.equal(apiCalls.length, contactCalls); checks.push('contact conversion requires review and reopens its existing linked lead on repeat');
run("leads=[];leadEditId=null;leadSalvando=false");
element('lead-email').value = 'stale@example.test'; element('lead-nome').value = 'Stale fixture';
let resolveStale; apiResponder = () => new Promise(resolve => { resolveStale = resolve; });
const stale = run('salvarLead(leadEvent)'); run('painelEpoch++');
resolveStale({ ok: true, lead: { id: 'stale_lead', empresa_id: 'clickdrop', status: 'novo' } });
await stale; assert.equal(run('leads.length'), 0); run('leadSalvando=false');
checks.push('late lead save cannot populate a new session');
run("emailAccounts=[{id:'box_a',can_send:true}];emailAccountsReady=true;emailMailboxId='box_a';emailDraftMailbox='box_a';emailView='in';emails=[{id:1,mailbox_id:'box_a',direcao:'in',assunto:'Invoice'},{id:2,mailbox_id:'box_a',direcao:'out',reply_to_id:1,status:'enviado'},{id:3,mailbox_id:'box_b',direcao:'in',assunto:'Other'}]");
assert.equal(run('DashboardOperations.emailSearchRows().length'), 1); checks.push('email list remains scoped to authorized current mailbox');
for (const callback of authCallbacks) callback('SIGNED_IN', { user: { id: 'fixture_user_a' } });
element('email-to').value = 'test@example.invalid'; element('email-subject').value = 'Fixture draft'; element('email-body').value = 'Private fixture';
run('DashboardOperations.saveEmailDraft()'); assert.equal(storage.size, 1);
assert.equal(run('DashboardOperations.readEmailDraft().body'), 'Private fixture');
run("emailMailboxId='box_b'"); assert.equal(run('DashboardOperations.readEmailDraft()'), null);
for (const callback of authCallbacks) callback('SIGNED_OUT', null);
assert.equal(storage.size, 0); checks.push('email recovery is isolated by user and mailbox and erased on sign-out');
await new Promise(resolve => setImmediate(resolve));
for (const callback of authCallbacks) callback('SIGNED_IN', { user: { id: 'fixture_user_b' } });
run("emailAccounts=[{id:'box_a',can_send:true}];emailAccountsReady=true;emailMailboxId='box_a';emailDraftMailbox='box_a';emailAccountsError='';emailListError='';emailLoading=false");
element('email-body').value = 'A draft that had a send attempt'; run('DashboardOperations.saveEmailDraft(true)');
element('email-body').value = ''; element('email-subject').value = ''; element('email-to').value = '';
const priorApiCalls = apiCalls.length; run('DashboardOperations.recoverEmailDraft()');
assert.equal(element('email-body').value, 'A draft that had a send attempt'); assert.match(element('email-feedback').textContent, /Confira Enviados/);
assert.equal(apiCalls.length, priorApiCalls); checks.push('recovered attempted email warns about uncertainty and never sends itself');
element('emails-list').parentNode = element('email-parent');
run("emailView='in';emails=Array.from({length:26},(_,index)=>({id:index+10,mailbox_id:'box_a',direcao:'in',assunto:'Message '+index,de:'fixture@example.test',created_at:'2026-11-14T12:00:00Z'}));renderEmails()");
assert.match(element('ops-email-page').textContent, /Página 1 de 2/); element('ops-email-next').listeners.get('click')[0]();
assert.match(element('ops-email-page').textContent, /Página 2 de 2/); assert.ok(element('emails-list').innerHTML.includes('Message 25'));
element('ops-email-search').listeners.get('input')[0]({ target: { value: 'Message 25' } });
assert.match(element('ops-email-page').textContent, /1 mensagem/); assert.ok(!element('emails-list').innerHTML.includes('Message 24'));
checks.push('email pagination and search browse the scoped loaded history');
run("empresasAcessiveis=new Set(['arcade_hub','clickdrop']);lancamentos={'Nov:clickdrop':{custos_diretos:100,pagador:'SAROM',meio_pagamento:'pix'}};custosExtras=[{mes:'Nov',empresa_id:'clickdrop',valor:50,pagador:'SAROM',meio_pagamento:'pix'}]");
apiResponder = () => ({ ok: true, reimbursements: [{ id: 'paid', socio: 'SAROM', valor: 40, status: 'confirmed' }, { id: 'cancelled', socio: 'SAROM', valor: 20, status: 'cancelled' }] });
await run('DashboardOperations.loadReimbursements(true)');
const balance = run("DashboardOperations.reimbursementTotals('SAROM')");
assert.equal(balance.expenses, 150); assert.equal(balance.reimbursed, 40); assert.equal(balance.pending, 110);
checks.push('reimbursements reduce personal debt only when confirmed');
for (const [id, value] of Object.entries({ 'ops-reimbursement-owner': 'SAROM', 'ops-reimbursement-value': '50', 'ops-reimbursement-date': '2026-11-01', 'ops-reimbursement-ref': 'Fixture receipt reference', 'ops-reimbursement-notes': 'Synthetic reimbursement' })) element(id).value = value;
const paymentRows = [{ id: 'paid', socio: 'SAROM', valor: 40, status: 'confirmed' }];
apiResponder = (_name, body) => {
  if (body.action === 'record_reimbursement') { paymentRows.push({ id: 'new_paid', ...body.payment, status: 'confirmed' }); return { ok: true, reimbursement: paymentRows.at(-1) }; }
  return { ok: true, reimbursements: paymentRows };
};
context.paymentEvent = { preventDefault() {} }; element('ops-reimbursement-feedback');
await run('DashboardOperations.recordReimbursement(paymentEvent)');
assert.equal(run("DashboardOperations.reimbursementTotals('SAROM').pending"), 60, element('ops-reimbursement-feedback').textContent);
assert.equal(apiCalls.at(-2).body.action, 'record_reimbursement'); assert.match(apiCalls.at(-2).body.request_id, /^[a-f0-9-]{36}$/i);
assert.equal(run("getLanc('Nov','clickdrop').custos_diretos"), 100); checks.push('reimbursement registration lowers debt without creating another cost or aporte');
run("acoesCal=[{data:'2026-11-15',dias_execucao:1,status:'todo',responsavel:['SAROM'],empresa_id:'clickdrop'},{data:'2026-11-10',dias_execucao:1,status:'todo',responsavel:[]}]");
const calendar = run("DashboardOperations.resumoCalendario('2026-11-14')");
assert.equal(calendar.upcoming, 1); assert.equal(calendar.overdue, 1); assert.equal(calendar.unassigned, 1); checks.push('calendar summary separates next seven days, overdue and ownership');
assert.equal(calendar.projects.ClickDrop, 1);
run("calFilters.quick='semana'");
assert.equal(run("calPassesFilter({data:calAddDays(calTodayISO(),6),dias_execucao:1,status:'todo'})"), true);
assert.equal(run("calPassesFilter({data:calAddDays(calTodayISO(),7),dias_execucao:1,status:'todo'})"), false);
run('calFilters.quick=null'); checks.push('calendar quick filter covers exactly seven local dates including today');
resultMode = 'ok'; element('cal-modal-empresa').value = 'clickdrop'; element('cal-modal-id').value = '';
element('cal-modal-titulo').value = 'Synthetic project action'; element('cal-modal-data').value = '2026-11-17';
await run('saveCalModal()'); assert.equal(calls.at(-1).payload.empresa_id, 'clickdrop');
assert.equal(run('acoesCal.at(-1).empresa_id'), 'clickdrop'); checks.push('calendar project is explicit and persisted without assigning old actions');
context.recibosFinanceiros = () => [
  { company: 'clickdrop', currency: 'BRL', row: { status: 'approved' }, date: new Date('2026-11-14T12:00:00Z'), gross: 100, fee: null, net: null },
  { company: 'clickdrop', currency: 'BRL', row: { status: 'rejected' }, date: new Date('2026-11-14T12:00:00Z'), gross: 900, fee: 0, net: 900 },
];
const commercial = run("buildPlanosSection('clickdrop')");
assert.match(commercial, /Recebimentos aprovados/); assert.match(commercial, /líquido não confirmado/); assert.doesNotMatch(commercial, /1\.000,00/);
assert.ok(commercial.includes(run("DashboardFinance.monthsToDate()[0]+'–'+DashboardFinance.monthsToDate().at(-1)+'/'+EXERCICIO")));
checks.push('plan comparison uses approved receipts, explicit period and unknown net without inventing zero');
const savedBeforeStructureFailure = savedCount; resultMode = 'fail';
run("estrutura_id=null;estrutura.investimento={fixture:10};saveEstrutura();estrutura.investimento.fixture=99");
await run('DashboardOperations.flushStructure()');
assert.equal(calls.at(-1).payload.investimento.fixture, 10); assert.equal(run('estrutura_id'), null); assert.equal(savedCount, savedBeforeStructureFailure);
assert.equal(run('estrutura.investimento.fixture'), 99); checks.push('budget failure preserves draft and uses a snapshot captured before debounce');
resultMode = 'ok'; run('saveEstrutura()'); await run('DashboardOperations.flushStructure()'); assert.ok(run('estrutura_id'));
run("estrutura_id=null;estrutura.investimento.fixture=100;saveEstrutura()");
interruptInsert = () => run('estrutura.investimento.fixture=200;saveEstrutura()');
await run('DashboardOperations.flushStructure()');
assert.deepEqual(calls.slice(-2).map(call => call.kind), ['insert', 'update']);
assert.equal(calls.at(-2).payload.investimento.fixture, 100); assert.equal(calls.at(-1).payload.investimento.fixture, 200);
checks.push('budget writes serialize edits and reuse the confirmed inserted ID');
run('estrutura_id=null;saveEstrutura()'); interruptInsert = () => run('painelEpoch++');
await run('DashboardOperations.flushStructure()'); assert.equal(run('estrutura_id'), null);
checks.push('late budget save cannot populate the next session');
run("selMonth='Nov';selCompany='clickdrop';selPlanMonth='Nov';lancamentos={'Nov:clickdrop':{receita:10}};planejado={'Nov:clickdrop':{receita_p:20}}");
element('fixture-plan-receita').setAttribute('oninput', "updatePlan('clickdrop','receita_p',this.value)");
element('lanc-receita');
resultMode = 'fail'; run("updateLanc('receita','99');updatePlan('clickdrop','receita_p','200')");
assert.equal(run("getLanc('Nov','clickdrop').receita"), 10); assert.equal(run("getPlan('Nov','clickdrop').receita_p"), 20);
assert.equal(run("getEmpresaMes('clickdrop','Nov').receita"), 10);
await run('DashboardOperations.flushManualSaves()');
assert.equal(run("getLanc('Nov','clickdrop').receita"), 10); assert.equal(run("getPlan('Nov','clickdrop').receita_p"), 20);
assert.equal(element('lanc-receita').value, 99); run('renderPlanejado()'); assert.equal(element('fixture-plan-receita').value, 200);
run('renderLancamentos()'); assert.equal(element('lanc-receita').value, 99); assert.equal(run("getLanc('Nov','clickdrop').receita"), 10);
assert.match(element('ops-manual-lanc-state').children.at(-1).textContent, /rascunho não confirmado/);
checks.push('failed manual revenue and plan saves retain draft inputs while financial totals stay confirmed');
resultMode = 'ok'; await run("saveLanc('Nov','clickdrop');savePlan('Nov','clickdrop')");
// Await the serialized queues as the inline handlers schedule both independently.
await run('DashboardOperations.flushManualSaves()');
assert.equal(run("getLanc('Nov','clickdrop').receita"), 99); assert.equal(run("getPlan('Nov','clickdrop').receita_p"), 200);
checks.push('manual revenue and plan totals update only after selected server rows confirm');
run("updateLanc('receita','300')");
interruptUpsert = () => run("updateLanc('receita','400');selCompany='priva_br';selMonth='Dez'");
await run('DashboardOperations.flushManualSaves()');
assert.deepEqual(calls.slice(-2).map(call => [call.payload.mes, call.payload.empresa_id, call.payload.receita]), [['Nov', 'clickdrop', 300], ['Nov', 'clickdrop', 400]]);
assert.equal(run("getLanc('Nov','clickdrop').receita"), 400); assert.equal(run("getLanc('Dez','priva_br').receita"), 0);
checks.push('manual writes serialize captured payloads without changing destination when selection changes');
run("selCompany='clickdrop';selMonth='Nov';updateLanc('receita','777');lancamentos={}");
interruptUpsert = () => run('painelEpoch++'); await run('DashboardOperations.flushManualSaves()');
assert.equal(run('Object.keys(lancamentos).length'), 0); checks.push('late manual revenue confirmation cannot repopulate a new session');
run("selMonth='Nov';selCompany='clickdrop';lancamentos={'Nov:clickdrop':{mes:'Nov',empresa_id:'clickdrop',receita:25}};estrutura_id=null;estrutura.investimento.fixture=321;updateLanc('receita','88');saveEstrutura()");
resultMode = 'fail'; await run('salvarTudoAgora()');
assert.equal(element('btn-salvar-tudo').dataset.saveState, 'error'); assert.match(element('btn-salvar-tudo').textContent, /rascunhos não confirmados/);
assert.equal(element('btn-salvar-tudo').disabled, false); assert.equal(run('estrutura_id'), null); assert.equal(run("getLanc('Nov','clickdrop').receita"), 25);
checks.push('save-all does not claim success when a dirty structure insert or manual write is rejected');
resultMode = 'ok'; await run('salvarTudoAgora()');
assert.equal(element('btn-salvar-tudo').dataset.saveState, 'saved'); assert.ok(run('estrutura_id')); assert.equal(run("getLanc('Nov','clickdrop').receita"), 88);
const callsAfterSaveAll = calls.length; await run('salvarTudoAgora()');
assert.equal(calls.length, callsAfterSaveAll); assert.equal(element('btn-salvar-tudo').textContent, 'Nenhuma alteração pendente');
checks.push('save-all retries only dirty snapshots, confirms their rows and leaves loaded confirmed records untouched');
context.operationsLoadFixture = async () => ['custos', 'recebimentos Stripe'];
readFailure = query => query.table === 'leads' && query.columns.includes('proxima_acao') ? { data: null, error: { message: 'Synthetic expanded lead read failure' } } : null;
const loadFailures = await run('loadAll(painelEpoch)');
assert.deepEqual([...loadFailures], ['custos', 'recebimentos Stripe', 'acompanhamento dos leads']);
const incomplete = run("DashboardFinance.financialInsights().find(item=>item.title==='Dados incompletos nesta sessão')");
assert.match(incomplete.detail, /custos/); assert.match(incomplete.detail, /recebimentos Stripe/); assert.match(incomplete.detail, /acompanhamento dos leads/);
checks.push('additional operational read failures reach financial insights without replacing prior failures');
console.log(JSON.stringify({ passed: checks.length, checks, network: false, productionWrites: false }, null, 2));
