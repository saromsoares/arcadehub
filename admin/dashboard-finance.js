/* Financial rules shared by all dashboard views. Classic script, no build. */
(function () {
  'use strict';
  const cents = value => Math.round((Number(value) || 0) * 100);
  const money = value => cents(value) / 100;
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const known = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const currency = row => String(row.moeda || 'BRL').toUpperCase();
  const byId = id => document.getElementById(id);
  const html = value => escapeHtml(String(value ?? ''));
  const zone = 'America/Sao_Paulo';
  const monthKey = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const localDate = new Intl.DateTimeFormat('pt-BR', { timeZone: zone, dateStyle: 'short' });
  const companyNames = new Map(COMPANIES.map(c => [c.id, c.name]));
  const providerNames = { mp: 'Mercado Pago', stripe: 'Stripe' };
  const statuses = { approved: 'Aprovado', refunded: 'Estornado', rejected: 'Recusado', pending: 'Pendente',
    in_process: 'Em análise', cancelled: 'Cancelado', charged_back: 'Contestado' };
  const receiptPageSize = 25;
  const defaultFilters = () => ({ search: '', period: String(EXERCICIO), provider: 'all', status: 'all', destination: 'all', page: 1 });
  let receiptFilters = defaultFilters();
  const FEE_CATEGORY = 'Taxas de pagamento';
  if (!CUSTO_CATS.includes(FEE_CATEGORY)) CUSTO_CATS.push(FEE_CATEGORY);
  let loadFailures = [];
  let painting = false;
  let refreshTimer = null;
  const receiptRevision = { mp: 0, stripe: 0 };
  const receiptRequest = { mp: 0, stripe: 0 };

  function monthsToDate(now = new Date()) {
    const [year, month] = monthKey.format(now).split('-').map(Number);
    if (EXERCICIO > year) return [];
    return MONTHS_OPERACIONAIS.filter(m => EXERCICIO < year || MONTHS.indexOf(m) < month);
  }
  function dateOf(row) {
    for (const value of [row.date_approved, row.date_created, row.created_at]) {
      if (value && !Number.isNaN(Date.parse(value))) return new Date(value);
    }
    return null;
  }
  const normalizedRows = new WeakMap();
  function normalizeReceipt(provider, row) {
    const cached = normalizedRows.get(row);
    if (cached) return cached;
    const date = dateOf(row);
    const period = date ? monthKey.format(date).slice(0, 7) : '';
    const gross = known(row.valor) ? num(row.valor) : null;
    const net = known(row.valor_liquido) ? num(row.valor_liquido) : null;
    const fee = known(row.taxa) ? num(row.taxa) : row.status === 'approved' && gross !== null && net !== null ? money(gross - net) : null;
    const legacyId = row.stripe_id || row.mp_id || row.payment_id || row.id;
    const externalId = String(row.mp_payment_id ?? legacyId);
    const receipt = { provider, row, externalId, ref: provider + ':' + legacyId, company: row.empresa_id || '',
      currency: currency(row), date, period, month: MONTHS[Number(period.slice(5)) - 1], gross, net, fee };
    normalizedRows.set(row, receipt);
    return receipt;
  }
  let indexCache;
  function receiptIndex() {
    const mp = paginaLiberada('mercadopago') ? mpRecebimentos : null;
    const stripe = paginaLiberada('stripe') ? stripeRecebimentos : null;
    if (indexCache?.mp === mp && indexCache?.stripe === stripe && indexCache.mpLength === mp?.length && indexCache.stripeLength === stripe?.length) return indexCache;
    const all = [], byPeriod = new Map();
    for (const [provider, rows] of [['mp', mp], ['stripe', stripe]]) {
      for (const row of rows || []) {
        const receipt = normalizeReceipt(provider, row);
        all.push(receipt);
        if (!byPeriod.has(receipt.period)) byPeriod.set(receipt.period, []);
        byPeriod.get(receipt.period).push(receipt);
      }
    }
    indexCache = { all, byPeriod, mp, stripe, mpLength: mp?.length, stripeLength: stripe?.length };
    return indexCache;
  }
  function receipts() {
    return receiptIndex().all;
  }
  function exerciseReceipts(month) {
    const index = receiptIndex();
    if (month) return index.byPeriod.get(EXERCICIO + '-' + String(MONTHS.indexOf(month) + 1).padStart(2, '0')) || [];
    return index.all.filter(r => r.period.startsWith(EXERCICIO + '-'));
  }
  function isApprovedBRL(r, company) {
    return r.row.status === 'approved' && r.currency === 'BRL' && (!company || r.company === company);
  }
  function sales(month, company) {
    return exerciseReceipts(month).filter(r => isApprovedBRL(r, company) && companyNames.has(r.company));
  }
  function feeReceipts(month, company) {
    return exerciseReceipts(month).filter(r => ['approved', 'refunded', 'charged_back'].includes(r.row.status) && r.currency === 'BRL'
      && r.company && !r.company.startsWith('aporte:') && (!company || r.company === company));
  }
  function fees(month, company) {
    return money(feeReceipts(month, company).reduce((total, r) => total + (r.fee || 0), 0));
  }
  function matchedManualFees(month, company) {
    const source = new Map(feeReceipts(month, company).filter(r => r.fee !== null).map(r => [r.ref, r]));
    const used = new Set();
    let total = 0;
    for (const item of custosExtras) {
      if (item.mes !== month || (company && item.empresa_id !== company) || !item.gateway_receipt_ref) continue;
      const r = source.get(item.gateway_receipt_ref);
      if (!r || r.company !== item.empresa_id || used.has(r.ref) || cents(item.valor) !== cents(r.fee)) continue;
      used.add(r.ref); total += r.fee;
    }
    return money(total);
  }
  function additionalFees(month, company) { return money(fees(month, company) - matchedManualFees(month, company)); }
  function grossByProvider(provider, month, company) {
    return money(sales(month, company).filter(r => r.provider === provider).reduce((n, r) => n + (r.gross ?? 0), 0));
  }
  getMpReceita = (month, company) => company ? grossByProvider('mp', month, company) : 0;
  getStripeReceita = (month, company) => company ? grossByProvider('stripe', month, company) : 0;
  function periodFees(provider) {
    const elapsed = monthsToDate();
    return money(feeReceipts().filter(r => r.provider === provider && companyNames.has(r.company) && elapsed.includes(r.month))
      .reduce((n, r) => n + (r.fee ?? 0), 0));
  }
  getMpTaxa = () => periodFees('mp');
  getStripeTaxa = () => periodFees('stripe');

  getEmpresaMes = function (company, month) {
    const entry = getLanc(month, company);
    const receitaManual = num(entry.receita);
    const receitaMp = getMpReceita(month, company), receitaStripe = getStripeReceita(month, company);
    const custosLegado = money(calcCustos(entry));
    const custosItens = money(getCustosExtras(month, company).reduce((n, item) => n + num(item.valor), 0));
    const taxasGateway = fees(month, company), taxasIncluidasManualmente = matchedManualFees(month, company);
    const sourceReceipts = sales(month, company);
    const taxasPendentes = sourceReceipts.filter(r => r.fee === null).length;
    const resultadoProvisorio = feeReceipts(month, company).some(r => needsReview(r) || differences(r) || r.gross === null || r.net === null || r.fee === null);
    const liquidoGateway = sourceReceipts.some(r => r.net === null) ? null : money(sourceReceipts.reduce((n, r) => n + r.net, 0));
    const receita = money(receitaManual + receitaMp + receitaStripe);
    const custos = money(custosLegado + custosItens + taxasGateway - taxasIncluidasManualmente);
    return { mes: month, receita, receitaManual, receitaMp, receitaStripe, custos, custosLegado, custosItens,
      taxasGateway, taxasIncluidasManualmente, taxasPendentes, liquidoGateway, resultadoProvisorio,
      resultado: money(receita - custos), headcount: num(entry.headcount) };
  };
  function planExists(company, months) { return months.some(m => Object.hasOwn(planejado, m + ':' + company)); }
  function favorableStatus(actual, planned, exists, tolerance = 0.15) {
    if (!exists) return 'SEM DADOS';
    if (actual >= planned) return 'VERDE';
    return planned - actual <= Math.max(Math.abs(planned) * tolerance, 0.01) ? 'AMARELO' : 'VERMELHO';
  }
  getYTD = function (cons) {
    const scope = monthsToDate();
    const data = cons.filter(c => scope.includes(c.mes));
    const fields = ['receita', 'custos', 'resultado', 'receitaP', 'custosP', 'resultadoP',
      'receitaComparavel', 'custosComparaveis', 'resultadoComparavel', 'planos'];
    return Object.fromEntries(fields.map(k => [k, money(data.reduce((n, c) => n + num(c[k]), 0))]));
  };
  getEmpresaYTD = function (company) {
    const months = monthsToDate();
    const data = months.map(m => getEmpresaMes(company, m));
    return { receita: money(data.reduce((n, r) => n + r.receita, 0)), custos: money(data.reduce((n, r) => n + r.custos, 0)),
      resultado: money(data.reduce((n, r) => n + r.resultado, 0)), hcAvg: months.length ? data.reduce((n, r) => n + r.headcount, 0) / months.length : 0 };
  };
  getCompaniesYTD = function () {
    const months = monthsToDate();
    return COMPANIES.map(company => {
      const value = getEmpresaYTD(company.id);
      const plannedMonths = months.filter(m => planExists(company.id, [m]));
      const plans = plannedMonths.map(m => getPlan(m, company.id));
      const receitaP = money(plans.reduce((n, p) => n + num(p.receita_p), 0));
      const resultadoP = money(plans.reduce((n, p) => n + calcResP(p), 0));
      const comparables = plannedMonths.map(m => getEmpresaMes(company.id, m));
      const receitaComparavel = money(comparables.reduce((n, r) => n + r.receita, 0));
      const resultadoComparavel = money(comparables.reduce((n, r) => n + r.resultado, 0));
      const hasPlan = plannedMonths.length > 0;
      const sr = favorableStatus(receitaComparavel, receitaP, hasPlan, 0.1);
      const se = favorableStatus(resultadoComparavel, resultadoP, hasPlan);
      const status = [sr, se].includes('VERMELHO') ? 'VERMELHO' : [sr, se].includes('AMARELO') ? 'AMARELO' : hasPlan ? 'VERDE' : 'SEM DADOS';
      return { ...company, ...value, receitaP, resultadoP, hasPlan, status, plannedMonths: plannedMonths.length,
        atR: receitaP > 0 ? receitaComparavel / receitaP : null,
        atRe: resultadoP > 0 ? resultadoComparavel / resultadoP : null,
        resultadoDelta: hasPlan ? money(resultadoComparavel - resultadoP) : null };
    });
  };
  const oldGetRealizado = getRealizadoCustoMes;
  getRealizadoCustoMes = function (month, category) {
    let total = num(oldGetRealizado(month, category));
    if (category === FEE_CATEGORY) total += additionalFees(month);
    if (category === 'Outros Custos') total += COMPANIES.reduce((n, c) => n + calcCustos(getLanc(month, c.id)), 0);
    return money(total);
  };
  getTotalRealizadoMes = month => money(CUSTO_CATS.reduce((n, c) => n + getRealizadoCustoMes(month, c), 0));
  function aporteFees() {
    const months = aporteMonths();
    return money(exerciseReceipts().filter(r => isApprovedBRL(r) && SOCIOS.some(s => r.company === 'aporte:' + s) && months.includes(r.month))
      .reduce((n, r) => n + (r.fee ?? 0), 0));
  }
  function aporteMonths() {
    const [year, month] = monthKey.format(new Date()).split('-').map(Number);
    return MONTHS.filter((_, index) => EXERCICIO < year || (EXERCICIO === year && index < month));
  }
  function aporte(provider, socio, month) {
    const months = month ? [month] : aporteMonths();
    return money(exerciseReceipts(month).filter(r => r.provider === provider && isApprovedBRL(r, 'aporte:' + socio)
      && months.includes(r.month)).reduce((n, r) => n + (r.gross ?? 0), 0));
  }
  getMpAporte = (socio, month) => aporte('mp', socio, month);
  getStripeAporte = (socio, month) => aporte('stripe', socio, month);
  getAporteSocioTotal = socio => money(aporteMonths().reduce((n, m) => n + num(getAporteSocioMes(socio, m)), 0) + getMpAporte(socio) + getStripeAporte(socio));
  getTotalAportes = function () {
    const values = estrutura.aportes || {};
    const manual = SOCIOS.some(s => typeof values[s] === 'object')
      ? SOCIOS.reduce((total, s) => total + aporteMonths().reduce((n, m) => n + num(values[s]?.[m]), 0), 0)
      : aporteMonths().reduce((n, m) => n + num(values[m]), 0);
    return money(manual + SOCIOS.reduce((n, s) => n + getMpAporte(s) + getStripeAporte(s), 0));
  };
  getTotals = function (cons = getConsolidado(), ytd = getYTD(cons)) {
    const months = monthsToDate();
    const actualCosts = months.map(getTotalRealizadoMes);
    const totalRealizadoAcum = money(actualCosts.reduce((n, value) => n + value, 0));
    const totalAportes = getTotalAportes();
    const feeAporte = aporteFees();
    const caixaAtual = money(totalAportes + ytd.receita - totalRealizadoAcum - feeAporte);
    const spentMonths = actualCosts.filter(value => value > 0).length;
    const burnRate = spentMonths ? money(totalRealizadoAcum / spentMonths) : 0;
    const totalCusto = money(CUSTO_CATS.reduce((n, cat) => n + num(estrutura.custos_mensais[cat]), 0));
    const totalInv = money(INV_CATS.reduce((n, cat) => n + num(estrutura.investimento[cat]), 0));
    const totalCustoAcum = money(MONTHS_OPERACIONAIS.reduce((n, m) => n + getTotalCustoMes(m), 0));
    return { ytd, totalCusto, totalCustoAcum, totalInv, totalAporteMeta: getTotalAporteMeta(), totalRealizadoAcum, totalAportes,
      custosForaDosProjetosAtivos: money(totalRealizadoAcum - ytd.custos),
      aportesLiquidos: money(totalAportes - feeAporte), taxasAportes: feeAporte,
      resultadoAcum: ytd.resultado, receitaRealizada: money(ytd.receita - getMpTaxa() - getStripeTaxa()),
      caixaAtual, burnRate, runway: burnRate > 0 ? Math.max(0, caixaAtual / burnRate) : null,
      margem: ytd.receita > 0 ? ytd.resultado / ytd.receita : 0 };
  };

  updateLancResult = function () {
    const value = getEmpresaMes(selCompany, selMonth);
    const card = byId('lanc-result-card');
    if (card) card.className = 'result-card ' + (value.resultado >= 0 ? 'result-positive' : 'result-negative');
    if (byId('lanc-result-value')) byId('lanc-result-value').textContent = fmt(value.resultado);
    if (byId('lanc-result-margem')) byId('lanc-result-margem').textContent = 'Margem: ' + (value.receita > 0 ? fmtPct(value.resultado / value.receita) : '—') + ' · inclui recebimentos e taxas';
    const table = byId('lanc-overview-table');
    if (table) table.innerHTML = COMPANIES.map(c => {
      const v = getEmpresaMes(c.id, selMonth);
      return '<tr><td>' + html(c.name) + '</td><td>' + fmt(v.receita) + '</td><td>' + fmt(v.resultado) + '</td><td>' + html(getLanc(selMonth, c.id).pagador || '—') + '</td></tr>';
    }).join('');
  };
  const originalEmpresaForm = buildEmpresaForm;
  buildEmpresaForm = function (company, month) {
    const value = getEmpresaMes(company, month);
    return '<div class="finance-summary">' + [
      ['Receita bruta total', value.receita], ['Receita manual', value.receitaManual],
      ['Mercado Pago + Stripe (bruto)', value.receitaMp + value.receitaStripe], ['Taxas conhecidas' + (value.taxasPendentes ? ' · há taxas pendentes' : ''), value.taxasGateway],
      ['Líquido de vendas aprovadas', value.liquidoGateway], ['Custos totais, incluindo taxas', value.custos], ['Resultado operacional' + (value.resultadoProvisorio ? ' · parcial' : ''), value.resultado],
    ].map(([label, amount]) => '<div><span>' + html(label) + '</span><strong>' + (amount === null ? 'Não informado' : fmt(amount)) + '</strong></div>').join('')
      + '</div><p class="insight-note">Taxas vinculadas explicitamente a um custo manual são reconhecidas uma única vez. Sem vínculo, a taxa mantém sua origem no recebimento.</p>'
      + (value.resultadoProvisorio ? '<p class="insight-note">Resultado parcial: taxas/líquido ou efeitos de estorno ainda precisam de conciliação. Taxas originais conhecidas são mantidas até confirmação de ajuste.</p>' : '')
      + (paginaLiberada('mercadopago') || paginaLiberada('stripe') ? '<button class="finance-action" type="button" data-finance-destination="' + html(company)
        + '" data-finance-period="' + EXERCICIO + '-' + String(MONTHS.indexOf(month) + 1).padStart(2, '0') + '">Ver pagamentos deste mês</button>' : '')
      + originalEmpresaForm(company, month).replace('Receita Bruta (R$)', 'Receita manual (R$)').replace('Total Custos (R$)', 'Custos por itens (R$)');
  };
  const originalComparativo = renderComparativo;
  function scopeChart(chart) {
    if (!chart?.data?.datasets) return;
    const elapsed = monthsToDate();
    chart.data.datasets.forEach(series => {
      if (!/Planejad/.test(series.label || '')) series.data = series.data.map((value, index) => elapsed.includes(chart.data.labels[index]) ? value : null);
    });
    chart.update();
  }
  renderComparativo = function (cons, ytd, companies) {
    originalComparativo(cons, ytd, companies);
    scopeChart(chartComp);
    const scope = monthsToDate();
    const rows = [
      { label: 'Receita realizada', value: c => c.receita, total: ytd.receita },
      { label: 'Receita planejada', value: c => c.planos ? c.receitaP : null, total: ytd.planos ? ytd.receitaP : null, planned: true },
      { label: 'Atingimento de receita', value: c => c.receitaP > 0 ? c.receitaComparavel / c.receitaP : null, total: ytd.receitaP > 0 ? ytd.receitaComparavel / ytd.receitaP : null, pct: true },
      { label: 'Custos realizados', value: c => c.custos, total: ytd.custos },
      { label: 'Custos planejados', value: c => c.planos ? c.custosP : null, total: ytd.planos ? ytd.custosP : null, planned: true },
      { label: 'Variação favorável de custos', value: c => c.planos ? c.custosP - c.custosComparaveis : null, total: ytd.planos ? ytd.custosP - ytd.custosComparaveis : null, delta: true },
      { label: 'Resultado realizado', value: c => c.resultado, total: ytd.resultado },
      { label: 'Resultado planejado', value: c => c.planos ? c.resultadoP : null, total: ytd.planos ? ytd.resultadoP : null, planned: true },
      { label: 'Variação favorável do resultado', value: c => c.planos ? c.resultadoComparavel - c.resultadoP : null, total: ytd.planos ? ytd.resultadoComparavel - ytd.resultadoP : null, delta: true },
    ];
    const monthly = byId('comp-table');
    const display = (row, value) => value === null ? '—' : row.pct ? fmtPct(value) : fmt(value);
    if (monthly) monthly.innerHTML = rows.map(row => '<tr><td>' + row.label + '</td>' + cons.map(c => {
      const value = row.planned || scope.includes(c.mes) ? row.value(c) : null;
      return '<td' + (!scope.includes(c.mes) ? ' title="Fora do acumulado corrente" style="color:#9CA3AF"' : row.delta && value < 0 ? ' style="color:#DC2626"' : '') + '>' + display(row, value) + '</td>';
    }).join('') + '<td><strong>' + display(row, row.total) + '</strong></td></tr>').join('');
    const table = byId('comp-empresa-table');
    if (table) table.innerHTML = companies.map(c => '<tr><td>' + html(c.name) + '</td><td>' + fmt(c.receita)
      + '</td><td>' + (c.hasPlan ? fmt(c.receitaP) + '<small class="receipt-source">' + c.plannedMonths + '/' + scope.length + ' meses com plano</small>' : 'Sem planejamento') + '</td><td>' + (c.atR === null ? '—' : fmtPct(c.atR))
      + '</td><td>' + fmt(c.resultado) + '</td><td>' + (c.hasPlan ? fmt(c.resultadoP) : '—') + '</td><td>'
      + (c.resultadoDelta === null ? '—' : (c.resultadoDelta >= 0 ? '+' : '') + fmt(c.resultadoDelta)) + '</td><td>' + badgeHtml(c.status) + '</td></tr>').join('');
    const note = byId('comparativo-explicacao');
    if (note) note.textContent = 'Acumulado até ' + (scope.at(-1) || 'o início do exercício') + '/' + EXERCICIO
      + '. Atingimento e variações usam somente os meses e projetos com plano. O realizado total inclui todos os projetos ativos. Variação favorável de custos = meta menos realizado. Para resultado, realizado menos meta.';
  };
  buildEmpresaAnualTable = function (company) {
    const categories = getCategoriasComCusto(company);
    const rows = [{ label: 'Receita bruta', value: m => getEmpresaMes(company, m).receita },
      ...categories.map(cat => ({ label: cat, value: m => getCustoEmpresaCatMes(m, company, cat) })),
      { label: 'Custos legados preservados', value: m => calcCustos(getLanc(m, company)) },
      { label: 'Taxas de gateway não incluídas nos itens', value: m => additionalFees(m, company) },
      { label: 'Total de custos', value: m => getEmpresaMes(company, m).custos },
      { label: 'Resultado operacional', value: m => getEmpresaMes(company, m).resultado }];
    return rows.map(row => '<tr><td><strong>' + html(row.label) + '</strong></td>' + MONTHS.map(m => '<td>' + fmt(row.value(m)) + '</td>').join('')
      + '<td><strong>' + fmt(monthsToDate().reduce((n, m) => n + row.value(m), 0)) + '</strong></td></tr>').join('');
  };

  function pendingReceipts() { return receipts().filter(r => r.row.status === 'approved' && !r.company); }
  function needsReview(r) {
    return Boolean(r.row.raw?.financial_review || ['refunded', 'charged_back'].includes(r.row.status) || r.row.status_detail === 'partial_refund');
  }
  function differences(r) {
    return r.gross !== null && r.net !== null && r.fee !== null && cents(r.gross) !== cents(r.net) + cents(r.fee);
  }
  function financialIssue(r) {
    return needsReview(r) || (r.row.status === 'approved' && (differences(r) || [r.gross, r.net, r.fee].includes(null)));
  }
  function isAporte(r) { return SOCIOS.some(s => r.company === 'aporte:' + s); }
  function isLegacy(r) { return r.company && !isAporte(r) && !companyNames.has(r.company); }
  function financialInsights() {
    const alerts = [];
    const issues = window.DashboardOperations?.getIssues?.() || [];
    for (const issue of issues) if (paginaLiberada(issue.page)) alerts.push({ tone: 'danger', title: 'Gravação ainda não confirmada', detail: issue.message, page: issue.page });
    const pending = pendingReceipts();
    if (pending.length) alerts.push({ tone: 'warning', title: pending.length + ' recebimento(s) aguardam classificação',
      detail: fmt(pending.filter(r => r.currency === 'BRL').reduce((n, r) => n + (r.gross ?? 0), 0)) + ' brutos informados em BRL. Revise se são receita de projeto ou aporte.',
      page: 'financeiro', destination: 'pending' });
    if (!Object.keys(planejado).length) alerts.push({ tone: 'info', title: 'Sem planejamento cadastrado', detail: 'Defina metas para comparar realizado e previsto no mesmo período.', page: 'estrutura' });
    if (loadFailures.length) alerts.push({ tone: 'danger', title: 'Dados incompletos nesta sessão', detail: loadFailures.join(', ') + '. Atualize a página antes de tomar decisões com os totais.', page: 'painel' });
    for (const [name, page, balance] of [['Mercado Pago', 'mercadopago', mpSaldo], ['Stripe', 'stripe', stripeSaldo]]) {
      if (!paginaLiberada(page)) continue;
      if (balance && (!balance.ok || balance.parcial || balance.desatualizado)) alerts.push({ tone: 'warning', title: name + ': confira a leitura',
        detail: balance.parcial ? 'Há conta sem leitura; o valor conhecido é parcial.' : balance.desatualizado ? 'O saldo tem referência antiga. Consulte a data da fonte no Financeiro.' : 'Não há saldo confirmado nesta consulta.', page: 'financeiro' });
    }
    const missingFee = receipts().filter(r => r.row.status === 'approved' && r.company && r.fee === null);
    if (missingFee.length) alerts.push({ tone: 'warning', title: 'Taxas ainda não informadas', detail: missingFee.length + ' recebimento(s) sem taxa/líquido confirmado. O resultado pode mudar após a conciliação.', page: 'financeiro' });
    const refundReview = receipts().filter(needsReview);
    if (refundReview.length) alerts.push({ tone: 'warning', title: 'Estornos e contestações para conciliar', detail: refundReview.length + ' recebimento(s). A taxa original não é presumida devolvida; confira os movimentos e o efeito financeiro confirmado.', page: 'financeiro' });
    const byRef = new Map(receipts().map(r => [r.ref, r]));
    const mismatched = custosExtras.filter(item => {
      const ref = item.gateway_receipt_ref;
      if (!ref || (ref.startsWith('mp:') && !paginaLiberada('mercadopago')) || (ref.startsWith('stripe:') && !paginaLiberada('stripe'))) return false;
      const r = byRef.get(ref);
      return !(r && r.company === item.empresa_id && r.month === item.mes && r.period.startsWith(EXERCICIO + '-') && r.fee !== null && cents(r.fee) === cents(item.valor));
    });
    if (mismatched.length) alerts.push({ tone: 'warning', title: 'Vínculos de taxa precisam de revisão', detail: mismatched.length + ' custo(s) não coincidem com a taxa do recebimento. Nenhum desconto automático foi feito nesses vínculos.', page: 'lancamentos' });
    const months = monthsToDate();
    if (months.length >= 2) {
      const current = months.at(-1), previous = months.at(-2);
      const values = COMPANIES.map(c => ({ c, now: getEmpresaMes(c.id, current), previous: getEmpresaMes(c.id, previous) }));
      for (const [field, label] of [['receita', 'receita'], ['custos', 'custos']]) {
        const drivers = values.map(x => ({ name: x.c.name, delta: money(x.now[field] - x.previous[field]) })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).filter(x => cents(x.delta));
        if (!drivers.length) continue;
        const total = money(drivers.reduce((sum, driver) => sum + driver.delta, 0));
        const shown = drivers.slice(0, 3);
        const remaining = money(drivers.slice(3).reduce((sum, driver) => sum + driver.delta, 0));
        const signed = amount => (amount > 0 ? '+' : '') + fmt(amount);
        alerts.push({ tone: 'info', title: 'O que mudou nos valores de ' + label + ': ' + current + ' × ' + previous,
          detail: 'Variação total: ' + signed(total) + '. ' + shown.map(d => d.name + ': ' + signed(d.delta)).join(' · ')
            + (drivers.length > 3 ? ' · Demais projetos: ' + signed(remaining) : '')
            + '. Soma dos projetos = variação total. Custos incluem itens, legado e taxas conhecidas. O mês corrente pode estar incompleto.', page: 'comparativo' });
      }
      const over = values.filter(x => planExists(x.c.id, [current]) && x.now.custos > num(getPlan(current, x.c.id).custos_diretos_p) + num(getPlan(current, x.c.id).folha_p) + num(getPlan(current, x.c.id).impostos_p) + num(getPlan(current, x.c.id).despesas_adm_p) + num(getPlan(current, x.c.id).outras_despesas_p));
      if (over.length) alerts.push({ tone: 'warning', title: 'Custos acima da meta do mês', detail: over.map(x => x.c.name).join(', ') + '. Confira as categorias e os itens antes de ajustar o orçamento.', page: 'estrutura' });
    }
    return alerts;
  }
  function renderInsights() {
    const box = byId('painel-insights');
    if (!box) return;
    const alerts = financialInsights();
    box.innerHTML = '<div class="section-title">Pendências e decisões</div><div class="insights-grid">'
      + (alerts.length ? alerts.map(a => '<article class="insight-card ' + a.tone + '"><strong>' + html(a.title) + '</strong><p>' + html(a.detail)
        + '</p><button type="button" data-finance-page="' + html(a.page) + '"' + (a.destination ? ' data-finance-focus="' + html(a.destination) + '"' : '')
        + '>Revisar</button></article>').join('')
        : '<article class="insight-card"><strong>Sem pendências financeiras identificadas</strong><p>Os alertas usam os dados carregados e não substituem a revisão dos extratos.</p></article>') + '</div>';
  }
  function formatMoney(value, code = 'BRL') {
    try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code }).format(num(value)); }
    catch { return html(code) + ' ' + num(value).toFixed(2); }
  }
  function amount(value, code) { return value === null ? '—' : formatMoney(value, code); }
  const receiptDate = r => r.date ? localDate.format(r.date) : '—';
  const searchKey = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  function sortedReceipts(list) {
    return [...list].sort((a, b) => (b.date?.getTime() ?? -Infinity) - (a.date?.getTime() ?? -Infinity) || a.ref.localeCompare(b.ref));
  }
  function destinationOptions() {
    return '<optgroup label="Projetos">' + COMPANIES.map(c => option(c.id, c.name)).join('') + '</optgroup>'
      + '<optgroup label="Aportes">' + SOCIOS.map(s => option('aporte:' + s, 'Aporte · ' + socioLabel(s))).join('') + '</optgroup>';
  }
  function option(value, label) { return '<option value="' + html(value) + '">' + html(label) + '</option>'; }
  function receiptSelect(r) {
    const current = r.company;
    const legacy = isLegacy(r) ? option(current, current + ' (histórico)') : '';
    const choices = (option('', 'Sem vínculo') + legacy + destinationOptions()).replace('value="' + html(current) + '"', 'value="' + html(current) + '" selected');
    const busy = window.DashboardSecurity?.pending.has(r.provider + ':' + r.row.id);
    return '<select class="receipt-destination" aria-label="Vínculo do pagamento ' + html(r.externalId) + '" data-finance-assign="' + r.provider
      + '" data-finance-row="' + html(r.row.id) + '"' + (busy ? ' disabled' : '') + '>' + choices + '</select>';
  }
  function receiptContext(r) {
    const source = r.row.raw?.account_source;
    const account = source === 'clickdrop' ? 'Conta ClickDrop' : source === 'arcade_hub' ? 'Conta Geral' : '';
    return html(r.row.descricao || 'Pagamento') + '<small class="receipt-source">' + html([account, r.externalId].filter(Boolean).join(' · ')) + '</small>';
  }
  function renderReceiptTable(provider) {
    const page = provider === 'stripe' ? 'stripe' : 'mercadopago';
    const key = provider === 'stripe' ? 'stripe' : 'mp';
    if (!paginaLiberada(page)) {
      for (const id of [key + '-kpis', key + '-receb-body']) if (byId(id)) byId(id).innerHTML = '';
      return;
    }
    const list = receipts().filter(r => r.provider === provider);
    const approved = list.filter(r => r.row.status === 'approved');
    const period = monthKey.format(new Date()).slice(0, 7);
    const totals = new Map();
    for (const r of approved) {
      const group = totals.get(r.currency) || { total: 0, month: 0, count: 0, unknown: 0, monthCount: 0, monthKnown: 0 };
      if (r.net !== null) group.total += r.net; else group.unknown++;
      group.count++;
      if (r.period === period) {
        group.monthCount++;
        if (r.net !== null) { group.month += r.net; group.monthKnown++; }
      }
      totals.set(r.currency, group);
    }
    const kpis = byId(key + '-kpis');
    if (kpis) kpis.innerHTML = [...totals].map(([code, t]) => kpiCard('Líquido informado no mês · ' + html(code),
      amount(t.monthKnown || !t.monthCount ? t.month : null, code), t.monthCount - t.monthKnown ? (t.monthCount - t.monthKnown) + ' sem líquido informado no mês' : 'Pagamentos aprovados', provider === 'stripe' ? '#635BFF' : '#009EE3')
      + kpiCard('Líquido informado no histórico · ' + html(code), amount(t.unknown < t.count ? t.total : null, code), t.count + ' aprovado(s)' + (t.unknown ? ' · ' + t.unknown + ' sem líquido informado' : ''), '#6D28D9')).join('');
    const body = byId(key + '-receb-body');
    if (!body) return;
    body.innerHTML = list.length ? sortedReceipts(list).slice(0, receiptPageSize).map(r =>
      '<tr><td>' + receiptDate(r) + '</td><td>' + receiptContext(r) + '</td><td>' + receiptSelect(r) + '</td><td>' + html(r.row.payer_nome || r.row.payer_email || '—')
      + '</td><td>' + html(r.row.tipo_pagamento || '—') + '</td><td>' + html(statuses[r.row.status] || r.row.status || '—') + '</td><td>' + amount(r.gross, r.currency)
      + '</td><td>' + amount(r.fee, r.currency) + '</td><td>' + amount(r.net, r.currency) + '</td></tr>').join('')
      : '<tr><td colspan="9">Nenhum recebimento carregado.</td></tr>';
  }
  renderStripe = function () { iniciarRealtimeStripe(); renderReceiptTable('stripe'); };
  renderMercadoPago = function () { iniciarRealtimeMP(); renderReceiptTable('mp'); };

  function renderReconciliation() {
    const box = byId('financeiro-inteligencia');
    if (!box) return;
    box.hidden = !paginaLiberada('mercadopago') && !paginaLiberada('stripe');
    if (box.hidden) {
      for (const id of ['summary', 'list', 'history']) byId('fin-receipt-' + id).innerHTML = '';
      return;
    }
    const periods = new Set([String(EXERCICIO), ...MONTHS.map((_, i) => EXERCICIO + '-' + String(i + 1).padStart(2, '0'))]);
    for (const r of receipts()) if (r.period) { periods.add(r.period.slice(0, 4)); periods.add(r.period); }
    periods.add(receiptFilters.period);
    const provider = [['mp', 'mercadopago'], ['stripe', 'stripe']].filter(([, page]) => paginaLiberada(page)).map(([key]) => key);
    if (!provider.includes(receiptFilters.provider)) receiptFilters.provider = 'all';
    const controls = {
      period: option('all', 'Todo o histórico') + [...periods].filter(value => value !== 'all').sort().reverse().map(value =>
        option(value, value.length === 4 ? 'Ano ' + value : MONTHS[Number(value.slice(5)) - 1] + '/' + value.slice(0, 4))).join(''),
      provider: option('all', 'Todos') + provider.map(key => option(key, providerNames[key])).join(''),
      destination: option('all', 'Todos') + option('pending', 'Sem vínculo') + option('legacy', 'Vínculos históricos')
        + option('aporte', 'Todos os aportes') + destinationOptions(),
    };
    for (const [key, options] of Object.entries(controls)) {
      const field = byId('fin-receipt-' + key);
      if (field.dataset.options !== options) {
        field.innerHTML = options;
        field.dataset.options = options;
      }
      field.value = receiptFilters[key];
    }
    for (const key of ['search', 'status']) byId('fin-receipt-' + key).value = receiptFilters[key];
    renderReconciliationRows();
    byId('fin-receipt-history').innerHTML = (paginaLiberada('stripe') && Array.isArray(stripeSaldo?.historico)
        ? '<p class="insight-note">Revisão histórica Stripe: ' + stripeSaldo.historico.map(h => html(h.account_key || h.id || '') + ' · '
          + (h.full_completed_at ? 'última rodada concluída em ' + new Date(h.full_completed_at).toLocaleString('pt-BR') : 'primeira rodada ainda não concluída')
          + (h.cursor_full ? ' · varredura em andamento' : '') + (h.error_sanitized ? ' · ' + html(h.error_sanitized) : '')).join(' | ') + '</p>' : '')
      + renderStripeMovements();
  }
  function filteredReceipts() {
    const { search, period, provider, status, destination } = receiptFilters;
    const terms = searchKey(search).split(/\s+/).filter(Boolean);
    const matchesDestination = r => destination === 'all' || (destination === 'pending' && !r.company)
      || (destination === 'legacy' && isLegacy(r)) || (destination === 'aporte' && isAporte(r)) || r.company === destination;
    return sortedReceipts(receipts().filter(r => {
      if (period !== 'all' && !r.period.startsWith(period)) return false;
      if (provider !== 'all' && r.provider !== provider) return false;
      if (status === 'approved' && r.row.status !== 'approved') return false;
      if (status === 'review' && !financialIssue(r)) return false;
      if (status === 'other' && (r.row.status === 'approved' || needsReview(r))) return false;
      if (!matchesDestination(r)) return false;
      if (!terms.length) return true;
      const description = searchKey([r.externalId, r.row.descricao, r.row.payer_nome, r.row.payer_email, r.row.raw?.external_reference].join(' '));
      return terms.every(term => description.includes(term));
    }));
  }
  function destinationName(r) {
    if (isAporte(r)) return 'Aporte · ' + socioLabel(r.company.slice(7));
    if (isLegacy(r)) return 'Histórico · ' + r.company;
    return companyNames.get(r.company) || 'Sem vínculo';
  }
  function summaries(list) {
    const groups = new Map();
    const approved = list.filter(r => r.row.status === 'approved');
    for (const r of approved) {
      const key = r.currency + ':' + r.company;
      if (!groups.has(key)) groups.set(key, { currency: r.currency, name: destinationName(r), count: 0,
        gross: 0, fee: 0, net: 0, counts: { gross: 0, fee: 0, net: 0 } });
      const group = groups.get(key);
      group.count++;
      for (const field of ['gross', 'fee', 'net']) if (r[field] !== null) {
        group[field] += r[field];
        group.counts[field]++;
      }
    }
    return { approved, groups: [...groups.values()].sort((a, b) => a.currency.localeCompare(b.currency) || b.gross - a.gross || a.name.localeCompare(b.name)) };
  }
  function renderReconciliationRows() {
    const list = filteredReceipts();
    const { approved, groups } = summaries(list);
    const complete = approved.filter(r => companyNames.has(r.company) || isAporte(r)).length;
    const pending = approved.filter(r => !r.company).length;
    const review = list.filter(financialIssue).length;
    const cell = (g, field) => amount(g.counts[field] ? g[field] : null, g.currency)
      + (g.counts[field] && g.counts[field] < g.count ? '<small class="receipt-source">' + g.counts[field] + '/' + g.count + ' com valor</small>' : '');
    const summary = byId('fin-receipt-summary');
    const expanded = summary.querySelector('details')?.open;
    summary.innerHTML = (loadFailures.some(label => label.startsWith('recebimentos'))
      ? '<p class="receipt-warning" role="status">Leitura incompleta. A última lista confirmada foi preservada quando disponível.</p>' : '')
      + '<p class="insight-note" aria-live="polite">' + approved.length + ' aprovados · ' + complete + ' vinculados a projeto ou aporte · '
      + pending + ' sem vínculo · ' + (approved.length - complete - pending) + ' históricos · ' + review + ' para conciliar.</p>'
      + (groups.length ? '<details class="receipt-breakdown"' + (expanded ? ' open' : '') + '><summary>Totais dos aprovados por destino e moeda</summary>'
        + '<div class="table-wrap"><table><thead><tr><th>Destino</th><th>Moeda</th><th>Pagamentos</th><th>Bruto</th><th>Taxas</th><th>Líquido</th></tr></thead><tbody>'
        + groups.map(g => '<tr><td>' + html(g.name) + '</td><td>' + html(g.currency) + '</td><td>' + g.count + '</td><td>' + cell(g, 'gross')
          + '</td><td>' + cell(g, 'fee') + '</td><td>' + cell(g, 'net') + '</td></tr>').join('')
        + '</tbody></table></div></details>' : '');
    const pages = Math.max(1, Math.ceil(list.length / receiptPageSize));
    receiptFilters.page = Math.min(pages, receiptFilters.page);
    const start = (receiptFilters.page - 1) * receiptPageSize;
    byId('fin-receipt-list').innerHTML = list.length ? '<div class="table-wrap"><table class="receipt-table"><thead><tr>'
      + '<th>Data</th><th>Origem e pagamento</th><th>Pagador</th><th>Situação</th><th>Bruto</th><th>Taxa</th><th>Líquido</th><th>Vínculo</th></tr></thead><tbody>'
      + list.slice(start, start + receiptPageSize).map(r => '<tr><td>' + receiptDate(r) + '</td><td><strong>' + providerNames[r.provider] + '</strong><br>'
        + receiptContext(r) + '</td><td>' + html(r.row.payer_nome || r.row.payer_email || '—') + '</td><td>' + html(statuses[r.row.status] || r.row.status || '—')
        + (needsReview(r) ? '<small class="receipt-source">Estorno ou contestação em revisão</small>' : differences(r) ? '<small class="receipt-source">Bruto, taxa e líquido divergem</small>'
          : financialIssue(r) ? '<small class="receipt-source">Valores incompletos</small>' : '')
        + '</td><td>' + amount(r.gross, r.currency) + '</td><td>' + amount(r.fee, r.currency) + '</td><td>' + amount(r.net, r.currency)
        + '</td><td>' + receiptSelect(r) + (!r.company && r.provider === 'stripe' && r.row.raw?.account_source === 'clickdrop'
          ? '<small class="receipt-source">Sugestão: ClickDrop, pela conta de origem</small>' : '') + '</td></tr>').join('')
      + '</tbody></table></div><div class="receipt-pagination"><span tabindex="-1" id="fin-receipt-count" aria-live="polite">' + (start + 1) + '–'
      + Math.min(start + receiptPageSize, list.length) + ' de ' + list.length + '</span>'
      + '<button class="finance-action" type="button" data-finance-step="-1"' + (receiptFilters.page === 1 ? ' disabled' : '') + '>Anterior</button>'
      + '<button class="finance-action" type="button" data-finance-step="1"' + (receiptFilters.page === pages ? ' disabled' : '') + '>Próxima</button></div>'
      : '<p class="insight-note" role="status">Nenhum pagamento corresponde aos filtros.</p>';
  }
  function renderStripeMovements() {
    if (!paginaLiberada('stripe') || !stripeSaldo?.ok) return '';
    const list = Array.isArray(stripeSaldo.movimentos) ? stripeSaldo.movimentos : [];
    const labels = { charge: 'Cobrança', payment: 'Pagamento', stripe_fee: 'Taxa Stripe', refund: 'Estorno', payout: 'Repasse bancário', payout_cancel: 'Repasse cancelado', adjustment: 'Ajuste', transfer: 'Transferência', payment_refund: 'Estorno de pagamento' };
    return '<div class="section-title">Movimentos recentes do saldo Stripe</div><p class="insight-note">Até 100 movimentos por conta, cobertura parcial. Valores com sinal conforme o extrato; taxas, estornos e repasses explicam diferenças entre vendas e saldo. Esta lista não representa o extrato completo nem soma nova receita.'
      + (stripeSaldo.movimentos_erro ? ' ' + html(stripeSaldo.movimentos_erro) : '') + '</p>'
      + (list.length ? '<div class="table-wrap"><table><thead><tr><th>Conta</th><th>Data</th><th>Tipo</th><th>Valor</th><th>Taxa</th><th>Líquido</th><th>Status</th></tr></thead><tbody>'
        + list.map(m => '<tr><td>' + html(m.conta_id === 'clickdrop' ? 'ClickDrop' : m.conta_id === 'arcade_hub' ? 'ARCADE HUB TECH' : m.conta_id) + '</td><td>'
          + (m.data && !Number.isNaN(Date.parse(m.data)) ? new Date(m.data).toLocaleString('pt-BR') : '—') + '</td><td>' + html(labels[m.tipo] || m.tipo || '—')
          + '</td><td>' + formatMoney(m.valor, m.moeda) + '</td><td>' + formatMoney(m.taxa, m.moeda) + '</td><td>' + formatMoney(m.liquido, m.moeda)
          + '</td><td>' + html(m.status === 'available' ? 'Disponível' : m.status === 'pending' ? 'Pendente' : m.status || '—') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<p class="insight-note">Nenhum movimento disponível nesta leitura.</p>');
  }
  function forecast(now = new Date()) {
    const elapsed = monthsToDate(now);
    const today = monthKey.format(now);
    const currentPeriod = today.slice(0, 7);
    const closed = elapsed.filter(m => EXERCICIO + '-' + String(MONTHS.indexOf(m) + 1).padStart(2, '0') < currentPeriod).slice(-3);
    const average = closed.length ? money(closed.reduce((n, m) => n + getTotalRealizadoMes(m), 0) / closed.length) : null;
    const current = elapsed.at(-1);
    const budget = current ? getTotalCustoMes(current) : 0;
    const state = estadoCaixaSaldos();
    const available = state.estado === 'ok' ? state.valor : null;
    const pendingParts = [];
    let pendingIncomplete = false;
    for (const [page, balance, amount] of [['stripe', stripeSaldo, stripeSaldo?.saldo?.a_liberar], ['mercadopago', mpSaldo, mpSaldo?.saldo ? mpParseSaldo(mpSaldo.saldo).pend : null]]) {
      if (!paginaLiberada(page)) continue;
      if (balance?.ok && balance.saldo_ok && known(amount)) pendingParts.push(num(amount)); else pendingIncomplete = true;
    }
    const pending = pendingParts.length ? money(pendingParts.reduce((sum, amount) => sum + amount, 0)) : null;
    const pendingDates = receipts().filter(r => r.provider === 'stripe' && r.row.status === 'approved' && r.currency === 'BRL' && !needsReview(r)
      && r.row.raw?.balance_status === 'pending' && r.row.raw?.available_on && r.net !== null)
      .map(r => ({ date: String(r.row.raw.available_on).slice(0, 10), net: r.net }))
      .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date >= today && !Number.isNaN(Date.parse(r.date)));
    const byDate = new Map();
    for (const part of pendingDates) byDate.set(part.date, money((byDate.get(part.date) || 0) + part.net));
    const dates = [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, net]) => ({ date, net }));
    const knownNet = money(dates.reduce((n, r) => n + r.net, 0));
    const scenarios = [0.8, 1, 1.2].map(factor => ({ label: factor === 1 ? 'Ritmo recente' : factor < 1 ? 'Consumo −20%' : 'Consumo +20%',
      monthly: average === null ? null : money(average * factor),
      after30: average === null || available === null ? null : money(available - average * factor),
      runway: average > 0 && available !== null ? Math.max(0, available / (average * factor)) : null }));
    return { available, pending, pendingIncomplete, average, budget, closed, dates, knownNet, unknownPending: pending === null ? null : money(Math.max(0, pending - knownNet)), scenarios,
      incomplete: state.estado !== 'ok' || Boolean(stripeSaldo?.parcial || stripeSaldo?.desatualizado || mpSaldo?.desatualizado || stripeSaldo?.ultima_consulta_erro || mpSaldo?.ultima_consulta_erro) || saldoDisponivelMercadoPago() === null || saldoDisponivelStripe() === null };
  }
  function renderForecast() {
    const box = byId('estrutura-projecao');
    if (!box || !paginaLiberada('estrutura')) return;
    const value = forecast();
    box.innerHTML = '<div class="section-title">Cenários de caixa</div><p class="insight-note">Base: disponível do Mercado Pago e Stripe; Nu Empresas fica de fora. Consumo médio dos últimos ' + value.closed.length
      + ' meses fechados (' + html(value.closed.join(', ') || 'sem histórico') + '). Sem receitas futuras presumidas. ' + (value.incomplete ? 'A base disponível tem leitura incompleta.' : '') + '</p>'
      + '<div class="finance-summary"><div><span>Disponível consultado</span><strong>' + (value.available === null ? 'Sem leitura' : fmt(value.available)) + '</strong></div><div><span>A liberar · fora do disponível' + (value.pendingIncomplete ? ' · leitura incompleta' : '') + '</span><strong>' + (value.pending === null ? 'Sem leitura' : fmt(value.pending))
      + '</strong></div><div><span>Consumo recente / mês</span><strong>' + (value.average === null ? 'Sem histórico' : fmt(value.average)) + '</strong></div><div><span>Orçamento mensal cadastrado</span><strong>' + fmt(value.budget) + '</strong></div></div>'
      + '<div class="table-wrap"><table><thead><tr><th>Cenário</th><th>Consumo mensal</th><th>Disponível após 30 dias sem novas entradas</th><th>Cobertura estimada</th></tr></thead><tbody>'
      + value.scenarios.map(s => '<tr><td>' + s.label + '</td><td>' + (s.monthly === null ? '—' : fmt(s.monthly)) + '</td><td>' + (s.after30 === null ? '—' : fmt(s.after30))
        + '</td><td>' + (s.runway === null ? '—' : fmtNum(s.runway) + ' meses') + '</td></tr>').join('') + '</tbody></table></div>'
      + '<p class="insight-note">Datas previstas de disponibilização Stripe: ' + (value.dates.length ? value.dates.map(d => d.date.split('-').reverse().join('/') + ' · ' + fmt(d.net)).join(' | ') : 'nenhuma data futura nos recebimentos carregados.')
      + ' Pendente sem data coberta: ' + (value.unknownPending === null ? 'sem leitura' : fmt(value.unknownPending)) + '. Disponibilização não é garantia de repasse bancário; ajustes e taxas podem alterar a cobertura.</p>';
  }
  function sourceTime(data) {
    const date = data?.referencia_tipo === 'geracao_relatorio' ? data.relatorio_gerado_em : data?.saldo_referencia_em || data?.atualizado_em;
    if (!date || Number.isNaN(Date.parse(date))) return 'Referência do saldo não informada pelo provedor';
    return (data.referencia_tipo === 'geracao_relatorio' ? 'Relatório gerado em ' : 'Referência ') + new Date(date).toLocaleString('pt-BR')
      + (data.referencia_tipo === 'geracao_relatorio' ? ' · instante exato do saldo não informado' : '') + (data.desatualizado ? ' · leitura antiga' : '');
  }
  const originalNuState = estadoSaldoNubank;
  estadoSaldoNubank = function () {
    const state = originalNuState();
    if (nuSaldo?.ok && nuSaldo.saldo_ok) state.sub = 'Meu Pluggy · ' + sourceTime(nuSaldo) + ' · fora do Caixa Atual'
      + (nuSaldo.consultado_em ? ' · consulta ' + new Date(nuSaldo.consultado_em).toLocaleString('pt-BR') : '');
    return state;
  };
  const originalCards = renderCartoesFinanceiro;
  function renderStripeAccounts() {
    const box = byId('fin-stripe-contas');
    if (!box) return;
    const accounts = paginaLiberada('stripe') && Array.isArray(stripeSaldo?.contas) ? stripeSaldo.contas : [];
    box.hidden = !accounts.length;
    box.innerHTML = accounts.map(account => {
      const label = account.id === 'arcade_hub' || account.nome === 'ARCADE HUB TECH' ? 'Stripe Geral'
        : account.id === 'clickdrop' || account.nome === 'ClickDrop' ? 'Stripe ClickDrop' : 'Stripe ' + (account.nome || 'Conta');
      if (!account.ok || !account.saldo) return '<div class="stripe-account"><dt>' + html(label) + '</dt><dd><strong>Sem leitura</strong></dd></div>';
      const balance = account.saldo;
      const available = known(balance.disponivel) ? num(balance.disponivel) : null;
      const pending = known(balance.a_liberar) ? num(balance.a_liberar) : null;
      const total = known(balance.total) ? num(balance.total) : available !== null && pending !== null ? money(available + pending) : null;
      const display = amount => amount === null ? 'Sem leitura' : formatMoney(amount, balance.moeda || 'BRL');
      return '<div class="stripe-account"><dt>' + html(label) + '</dt><dd><strong' + (total < 0 ? ' class="negative"' : '') + '>' + display(total)
        + '</strong><small>Disponível ' + display(available) + '<br>A liberar ' + display(pending) + '</small></dd></div>';
    }).join('');
  }
  renderCartoesFinanceiro = function () {
    originalCards();
    renderStripeAccounts();
    for (const [key, page, data] of [['mp', 'mercadopago', mpSaldo], ['stripe', 'stripe', stripeSaldo]]) {
      if (!paginaLiberada(page) || !data?.ok) continue;
      const extra = byId('fin-' + key + '-extra');
      if (extra) extra.textContent += ' · ' + sourceTime(data);
    }
    renderReconciliation();
  };
  const originalMPText = textoMercadoPagoCaixa;
  textoMercadoPagoCaixa = () => originalMPText() + (mpSaldo?.desatualizado ? ' · referência antiga' : '');
  textoStripeCaixa = () => (stripeSaldo?.parcial ? 'Stripe parcial · há conta sem leitura' : 'Stripe') + (stripeSaldo?.desatualizado ? ' · referência antiga' : '');
  const originalPainel = renderPainel;
  renderPainel = function (...args) {
    originalPainel(...args);
    scopeChart(chartPainel);
    const kpis = byId('painel-kpis');
    if (kpis) kpis.innerHTML = kpis.innerHTML.replace('>Runway<', '>Runway teórico<')
      .replace(args[2]?.runway === null ? '0,0 meses' : '__no_replacement__', 'Sem histórico de consumo');
    renderInsights();
  };
  const originalEstrutura = renderEstrutura;
  renderEstrutura = function (...args) {
    originalEstrutura(...args);
    for (const id of ['caixa-cards', 'estr-summary-cards']) {
      const element = byId(id);
      if (element) element.innerHTML = element.innerHTML.replace(/>Runway</g, '>Runway teórico<')
        .replace(args[0]?.runway === null ? /0,0 (?:meses|m)/g : /__no_replacement__/g, 'Sem histórico de consumo');
    }
    const historical = byId('estrutura-custos-historicos');
    if (historical) {
      const value = args[0]?.custosForaDosProjetosAtivos ?? 0;
      historical.textContent = value ? 'Custos fora dos projetos ativos no acumulado do caixa teórico ' + fmt(value) + '.' : '';
    }
    renderForecast();
  };
  const originalLoad = loadAll;
  loadAll = async function (epoch) {
    const failures = await originalLoad(epoch);
    if (epoch !== painelEpoch) return failures;
    const reads = await Promise.all([loadReceipts('mp', false), loadReceipts('stripe', false)]);
    if (epoch !== painelEpoch) return failures;
    loadFailures = [...(failures || []), ...(!reads[0] ? ['recebimentos Mercado Pago'] : []), ...(!reads[1] ? ['recebimentos Stripe'] : [])];
    return loadFailures;
  };
  function repaint() {
    if (painting) return;
    painting = true;
    try {
      if (typeof preservarRascunhosDashboard === 'function') preservarRascunhosDashboard(() => renderAll());
      else renderAll();
    } finally { painting = false; }
  }
  async function loadReceipts(provider, paint = true) {
    const page = provider === 'stripe' ? 'stripe' : 'mercadopago';
    if (!paginaLiberada(page)) return true;
    const epoch = painelEpoch;
    const revision = receiptRevision[provider], request = ++receiptRequest[provider];
    const rows = [];
    let complete = false, expected = null;
    while (rows.length < 50000) {
      const result = await comTempoLimite(sb.from(provider === 'stripe' ? 'stripe_recebimentos' : 'mp_recebimentos').select('*', rows.length ? {} : { count: 'exact' })
        .order('date_approved', { ascending: false, nullsFirst: false }).order('id', { ascending: true }).range(rows.length, rows.length + 499), 12000);
      if (epoch !== painelEpoch || !paginaLiberada(page)) return false;
      if (result.error || !Array.isArray(result.data)) break;
      rows.push(...result.data);
      if (known(result.count)) expected = Number(result.count);
      if (known(expected) ? rows.length >= expected : result.data.length < 500) { complete = true; break; }
      if (!result.data.length) break;
    }
    if (request !== receiptRequest[provider]) return true;
    if (!complete || new Set(rows.map(row => row.id)).size !== rows.length) {
      const label = 'recebimentos ' + providerNames[provider];
      if (!loadFailures.includes(label)) loadFailures.push(label);
      if (paint) { renderReconciliationRows(); renderInsights(); }
      return false;
    }
    if (revision !== receiptRevision[provider]) {
      setTimeout(() => { if (epoch === painelEpoch && request === receiptRequest[provider]) loadReceipts(provider, paint); }, 400);
      return true;
    }
    if (provider === 'stripe') stripeRecebimentos = rows; else mpRecebimentos = rows;
    loadFailures = loadFailures.filter(label => !(provider === 'stripe' ? ['Stripe', 'recebimentos Stripe'] : ['Mercado Pago', 'recebimentos Mercado Pago']).includes(label));
    if (paint) repaint();
    return true;
  }
  carregarRecebimentosStripe = () => loadReceipts('stripe');
  window.carregarRecebimentosMP = () => loadReceipts('mp');
  async function loadBalance(provider) {
    if (provider === 'stripe' ? stripeSaldoLoading : mpSaldoLoading) return;
    const epoch = painelEpoch;
    if (provider === 'stripe') stripeSaldoLoading = true; else mpSaldoLoading = true;
    const key = provider === 'stripe' ? 'stripe' : 'mp';
    const button = byId(key + '-btn-refresh');
    if (button) { button.disabled = true; button.textContent = 'Consultando…'; }
    try {
      const result = await comTempoLimite(sb.functions.invoke(provider === 'stripe' ? 'stripe-saldo' : 'mp-saldo'), 22000);
      if (epoch !== painelEpoch) return;
      if (result.error || !result.data?.ok || !result.data?.saldo_ok || !result.data?.saldo) {
        const previous = provider === 'stripe' ? stripeSaldo : mpSaldo;
        if (previous?.ok && previous?.saldo_ok) {
          previous.desatualizado = true; previous.ultima_consulta_erro = true;
          previous.ultima_tentativa_em = new Date().toISOString();
          previous.saldo_erro = result.data?.saldo_erro || 'indisponivel';
          toast('A consulta falhou. Mantivemos o último saldo confirmado com aviso de leitura antiga.', 'erro');
        } else {
          const failure = result.data?.ok ? result.data : { ok: false, error: 'Não foi possível consultar o saldo.' };
          if (provider === 'stripe') stripeSaldo = failure; else mpSaldo = failure;
        }
      } else if (provider === 'stripe') { stripeSaldo = result.data; stripeSaldoTs = new Date(); }
      else { mpSaldo = result.data; mpSaldoTs = new Date(); if (result.data.saldo_ok) mpRelatorioEsperas = 0; }
      if (paginaLiberada(provider === 'mp' ? 'mercadopago' : 'stripe') && byId('tab-financeiro')?.classList.contains('active')) await loadReceipts(provider);
    } finally {
      if (epoch === painelEpoch) {
        if (provider === 'stripe') stripeSaldoLoading = false; else mpSaldoLoading = false;
        if (button) { button.disabled = false; button.textContent = 'Atualizar'; }
        renderCartoesFinanceiro(); pintarCaixasAtuais(); renderInsights(); renderForecast();
        if (provider === 'mp' && mpSaldo?.saldo_erro === 'preparando' && mpRelatorioEsperas < 15 && !mpRelatorioTimer) {
          mpRelatorioEsperas++;
          mpRelatorioTimer = setTimeout(() => { mpRelatorioTimer = null; if (epoch === painelEpoch) carregarSaldoMP(); }, 20000);
        }
      }
    }
  }
  carregarSaldoMP = () => loadBalance('mp');
  carregarSaldoStripe = () => loadBalance('stripe');
  function realtime(provider) {
    const page = provider === 'stripe' ? 'stripe' : 'mercadopago';
    if (!paginaLiberada(page) || (provider === 'stripe' ? stripeRealtimeOn : mpRealtimeOn)) return;
    if (provider === 'stripe') stripeRealtimeOn = true; else mpRealtimeOn = true;
    const epoch = painelEpoch;
    const channel = sb.channel(provider + '-recebimentos-rt-v3');
    channel.on('postgres_changes', { event: '*', schema: 'public', table: provider === 'stripe' ? 'stripe_recebimentos' : 'mp_recebimentos' }, payload => {
      if (epoch !== painelEpoch || !paginaLiberada(page)) return;
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!row?.id) return;
      receiptRevision[provider]++;
      let list = provider === 'stripe' ? stripeRecebimentos : mpRecebimentos;
      list = payload.eventType === 'DELETE' ? list.filter(r => r.id !== row.id) : list.some(r => r.id === row.id) ? list.map(r => r.id === row.id ? { ...r, ...row } : r) : [row, ...list];
      if (provider === 'stripe') stripeRecebimentos = list; else mpRecebimentos = list;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { if (epoch === painelEpoch) repaint(); }, 180);
    }).subscribe(status => {
      if (epoch !== painelEpoch) return;
      const dot = byId((provider === 'stripe' ? 'stripe' : 'mp') + '-live-dot');
      if (dot) dot.style.display = status === 'SUBSCRIBED' ? 'inline' : 'none';
    });
    const timer = setInterval(() => {
      if (epoch === painelEpoch && paginaLiberada(page) && byId('tab-financeiro')?.classList.contains('active')) loadBalance(provider);
    }, 60000);
    if (provider === 'stripe') stripePollTimer = timer; else mpPollTimer = timer;
  }
  iniciarRealtimeMP = () => realtime('mp');
  iniciarRealtimeStripe = () => realtime('stripe');
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-finance-page]');
    if (button && paginaLiberada(button.dataset.financePage)) {
      const destination = button.dataset.financeFocus;
      if (destination) openReceipts(destination, 'all', 'approved');
      else showTab(button.dataset.financePage);
    }
    const project = event.target.closest?.('[data-finance-destination]');
    if (project) openReceipts(project.dataset.financeDestination, project.dataset.financePeriod);
    const step = event.target.closest?.('[data-finance-step]');
    if (step) {
      receiptFilters.page += Number(step.dataset.financeStep);
      renderReconciliationRows();
      byId('fin-receipt-count')?.focus();
    }
  });
  function openReceipts(destination, period, status = 'all') {
    if (!paginaLiberada('stripe') && !paginaLiberada('mercadopago')) return;
    receiptFilters = { ...defaultFilters(), destination, period, status };
    showTab('financeiro');
    renderReconciliation();
    byId('fin-receipts-title')?.focus();
  }
  document.addEventListener('input', event => {
    if (event.target.id !== 'fin-receipt-search') return;
    receiptFilters.search = event.target.value;
    receiptFilters.page = 1;
    renderReconciliationRows();
  });
  document.addEventListener('change', async event => {
    const field = event.target;
    for (const key of ['period', 'provider', 'status', 'destination']) if (field.id === 'fin-receipt-' + key) {
      receiptFilters[key] = field.value;
      receiptFilters.page = 1;
      renderReconciliationRows();
      return;
    }
    const provider = field.dataset?.financeAssign;
    if (!provider) return;
    const epoch = painelEpoch;
    const id = field.dataset.financeRow;
    const before = receipts().find(r => r.provider === provider && String(r.row.id) === id)?.company || '';
    field.disabled = true;
    try {
      const finished = await (provider === 'stripe' ? atribuirEmpresaStripe(id, field.value) : atribuirEmpresaMP(id, field.value));
      if (!finished && epoch === painelEpoch) field.value = before;
    } finally {
      if (epoch === painelEpoch) {
        field.disabled = false;
        if (!field.isConnected && byId('tab-financeiro')?.classList.contains('active') && document.activeElement === document.body) {
          const replacement = [...document.querySelectorAll('[data-finance-assign]')].find(item => item.dataset.financeAssign === provider && item.dataset.financeRow === id);
          (replacement || byId('fin-receipt-search'))?.focus();
        }
      }
    }
  });
  const previousReset = resetState;
  resetState = async function (...args) {
    clearTimeout(refreshTimer); refreshTimer = null;
    loadFailures = []; indexCache = null; receiptFilters = defaultFilters();
    for (const provider of ['mp', 'stripe']) { receiptRevision[provider]++; receiptRequest[provider]++; }
    const result = await previousReset(...args);
    const search = byId('fin-receipt-search');
    if (search) search.value = '';
    return result;
  };
  window.recibosFinanceiros = receipts;
  window.getPendingReceipts = pendingReceipts;
  window.dashboardFinancialInsights = financialInsights;
  window.DashboardFinance = { receipts, pendingReceipts, financialInsights, forecast, monthsToDate, favorableStatus,
    projectSummary: (id, month) => getEmpresaMes(id, month), fees, matchedManualFees, formatMoney, renderInsights,
    receiptChanged: provider => { receiptRevision[provider]++; }, reloadReceipts: loadReceipts, receiptDate,
    setLoadFailures: failures => { loadFailures = failures || []; } };
})();
