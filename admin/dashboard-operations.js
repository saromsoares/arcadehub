/* Operational corrections and explainable workflow aids. Classic script, no build. */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const text = (id, value) => { const element = byId(id); if (element) element.textContent = value; };
  const writes = new Set();
  const drafts = new Map();
  const issues = new Map();
  const manualSaves = new Map();
  let confirmedAportes = JSON.parse(JSON.stringify(estrutura.aportes || {}));
  let preserving = false;
  let emailOwner = '';
  let emailIdentityVersion = 0;
  const current = epoch => epoch === painelEpoch;
  const knownCompany = id => COMPANIES.some(company => company.id === id);
  const notifyError = error => toast(error?.message || 'Não foi possível gravar. Seu rascunho foi mantido.', 'erro');

  function statusFor(id, state, message) {
    const page = id === 'tab-estrutura' ? 'estrutura' : id.startsWith('cal-') ? 'calendario' : id.startsWith('plano-') ? 'empresa' : 'lancamentos';
    if (state === 'error') issues.set(id, { id, page, message });
    else if (state === 'saved' || state === 'draft') issues.delete(id);
    const box = byId(id);
    if (!box) return;
    box.dataset.writeState = state;
    let status = box.querySelector?.('[data-ops-status]');
    if (!status && document.createElement && box.appendChild) {
      status = document.createElement('p');
      status.dataset.opsStatus = '1';
      status.setAttribute('role', 'status');
      status.style.cssText = 'font-size:12px;margin:10px 0 0;overflow-wrap:anywhere;';
      box.appendChild(status);
    }
    if (status) {
      status.textContent = message;
      status.style.color = state === 'error' ? '#B91C1C' : state === 'saved' ? '#047857' : '#475569';
    }
  }

  async function confirmed(request, label) {
    const result = await db(request, label);
    if (!result?.data || (Array.isArray(result.data) && !result.data.length)) {
      throw new Error('O servidor não confirmou o registro. Verifique sua conexão e tente novamente.');
    }
    return result.data;
  }

  function snapshotForm(id, scope) {
    const form = byId(id);
    if (!form || form.style.display === 'none' || !form.querySelectorAll) return null;
    if (form.dataset?.opsScope && form.dataset.opsScope !== scope) return null;
    return {
      id, scope, epoch: painelEpoch, display: form.style.display,
      dataset: { ...form.dataset },
      fields: Array.from(form.querySelectorAll('input[id],select[id],textarea[id]')).map(element => ({
        id: element.id, value: element.value, checked: element.checked,
        selectionStart: element.selectionStart, selectionEnd: element.selectionEnd,
      })),
      focusId: form.contains?.(document.activeElement) ? document.activeElement.id : '',
    };
  }

  function restoreForm(snapshot) {
    if (!snapshot || !current(snapshot.epoch)) return;
    const scope = snapshot.id === 'plano-form' ? currentEmpresaId : selCompany + ':' + selMonth;
    if (scope !== snapshot.scope) return;
    const form = byId(snapshot.id);
    if (!form) return;
    form.style.display = snapshot.id === 'lanc-form' ? snapshot.display || '' : snapshot.display || 'block';
    Object.assign(form.dataset, snapshot.dataset);
    if (snapshot.id === 'lanc-custo-extra-form') mountGatewayField(snapshot.dataset.editId);
    for (const field of snapshot.fields) {
      const element = byId(field.id);
      if (!element) continue;
      element.value = field.value;
      if (typeof field.checked === 'boolean') element.checked = field.checked;
      if (field.id === snapshot.focusId) {
        element.focus?.({ preventScroll: true });
        try { element.setSelectionRange?.(field.selectionStart, field.selectionEnd); } catch (_) { /* number inputs */ }
      }
    }
  }

  function preserveDrafts(fn) {
    if (preserving) return fn();
    const active = document.activeElement;
    const entryFocus = active?.id && byId('lanc-form')?.contains?.(active) ? { id: active.id, scope: selCompany + ':' + selMonth, start: active.selectionStart, end: active.selectionEnd } : null;
    const snapshots = [
      snapshotForm('lanc-custo-extra-form', selCompany + ':' + selMonth),
      snapshotForm('plano-form', currentEmpresaId),
      manualSaves.get(manualKey('lanc', selMonth, selCompany))?.draft ? snapshotForm('lanc-form', selCompany + ':' + selMonth) : null,
    ];
    preserving = true;
    try { return fn(); }
    finally {
      preserving = false; snapshots.forEach(restoreForm); restoreManualDraftInputs();
      if (entryFocus?.scope === selCompany + ':' + selMonth) {
        const input = byId(entryFocus.id); input?.focus?.({ preventScroll: true });
        try { input?.setSelectionRange?.(entryFocus.start, entryFocus.end); } catch (_) { /* numeric inputs do not support selection */ }
      }
    }
  }

  const copy = value => JSON.parse(JSON.stringify(value));
  function confirmStructureAportes(snapshot) {
    const values = copy(snapshot?.aportes || {});
    confirmedAportes = SOCIOS.some(socio => values[socio] && typeof values[socio] === 'object')
      ? values : { [SOCIOS[0]]: Object.fromEntries(MONTHS.map(month => [month, Number(values[month]) || 0])) };
  }
  function withConfirmedAportes(fn, args) {
    const draft = estrutura.aportes;
    estrutura.aportes = confirmedAportes;
    try { return fn(...args); } finally { estrutura.aportes = draft; }
  }
  // Editable cells retain their draft; equity and cash totals use server-confirmed facts.
  const confirmedTotalAportes = getTotalAportes, confirmedSocioTotal = getAporteSocioTotal, confirmedMonthTotal = getAporteMesTotal;
  getTotalAportes = (...args) => withConfirmedAportes(confirmedTotalAportes, args);
  getAporteSocioTotal = (...args) => withConfirmedAportes(confirmedSocioTotal, args);
  getAporteMesTotal = (...args) => withConfirmedAportes(confirmedMonthTotal, args);
  function repaintConfirmedStructure() {
    const active = document.activeElement, handler = active?.getAttribute?.('oninput'), id = active?.id;
    preserveDrafts(() => renderAll());
    const replacement = id ? byId(id) : handler ? [...document.querySelectorAll('input[oninput]')].find(input => input.getAttribute('oninput') === handler) : null;
    replacement?.focus?.({ preventScroll: true });
  }
  const manualKey = (kind, month, company, epoch = painelEpoch) => epoch + ':' + kind + ':' + EXERCICIO + ':' + month + ':' + company;
  function manualState(kind, month, company) {
    const key = manualKey(kind, month, company);
    let state = manualSaves.get(key);
    if (!state) {
      state = { key, kind, month, company, epoch: painelEpoch, draft: copy(kind === 'lanc' ? getLanc(month, company) : getPlan(month, company)), revision: 0, pending: null, running: null, timer: null, error: false };
      manualSaves.set(key, state);
    }
    return state;
  }
  function manualPayload(state) {
    const source = state.draft;
    const names = state.kind === 'lanc' ? ['receita', 'custos_diretos', 'folha', 'impostos', 'despesas_adm', 'outras_despesas', 'headcount']
      : ['receita_p', 'custos_diretos_p', 'folha_p', 'impostos_p', 'despesas_adm_p', 'outras_despesas_p', 'headcount_p'];
    const payload = { mes: state.month, ano: EXERCICIO, empresa_id: state.company, updated_at: new Date().toISOString() };
    for (const name of names) payload[name] = Number(source[name]) || 0;
    if (state.kind === 'lanc') for (const name of ['obs', 'pagador', 'meio_pagamento']) payload[name] = String(source[name] || '');
    return payload;
  }
  function scheduleManual(state) {
    state.pending = { revision: state.revision, payload: manualPayload(state) };
    state.error = false; clearTimeout(state.timer);
    state.timer = setTimeout(() => flushManual(state), 700);
    restoreManualDraftInputs();
  }
  async function flushManual(state) {
    if (!state || !current(state.epoch)) return null;
    if (state.running) return state.running;
    clearTimeout(state.timer); state.timer = null;
    state.running = (async () => {
      let last = null;
      while (state.pending && current(state.epoch)) {
        const snapshot = state.pending; state.pending = null;
        try {
          const table = state.kind === 'lanc' ? 'lancamentos' : 'planejado';
          const saved = await confirmed(sb.from(table).upsert(snapshot.payload, { onConflict: 'ano,mes,empresa_id' }).select('*').single(), 'salvar ' + table);
          if (!current(state.epoch)) return null;
          if (saved.mes !== state.month || saved.empresa_id !== state.company || Number(saved.ano) !== EXERCICIO) throw new Error('O servidor não confirmou o mês e a empresa deste registro.');
          const key = state.month + ':' + state.company;
          if (state.kind === 'lanc') lancamentos[key] = saved; else planejado[key] = saved;
          last = saved; issues.delete('manual:' + state.key);
          if (state.revision === snapshot.revision && !state.pending) {
            state.draft = null; state.error = false;
            showSaving(state.kind === 'lanc' ? 'saving-lanc' : 'saving-plan');
          }
        } catch (error) {
          if (!current(state.epoch)) return null;
          state.error = true;
          issues.set('manual:' + state.key, { id: state.key, page: state.kind === 'lanc' ? 'lancamentos' : 'planejado', message: 'Rascunho de ' + (COMPANIES.find(company => company.id === state.company)?.name || state.company) + ' / ' + state.month + ' não foi confirmado. Os totais mantêm o valor salvo anteriormente.' });
          notifyError(error);
          if (!state.pending) break;
        }
      }
      if (current(state.epoch)) {
        if (last) preserveDrafts(() => renderAll());
        restoreManualDraftInputs(); if (state.kind === 'lanc') updateLancResult();
      }
      return last;
    })();
    try { return await state.running; }
    finally { state.running = null; if (!state.draft && !state.pending && manualSaves.get(state.key) === state) manualSaves.delete(state.key); }
  }
  function saveManual(kind, month, company) {
    if (!MONTHS.includes(month) || !knownCompany(company)) return Promise.resolve(null);
    const state = manualState(kind, month, company); state.revision++; scheduleManual(state);
    return flushManual(state);
  }
  saveLanc = (month, company) => saveManual('lanc', month, company);
  savePlan = (month, company) => saveManual('plan', month, company);
  function updateManual(kind, month, company, key, value) {
    if (!MONTHS.includes(month) || !knownCompany(company)) return;
    const state = manualState(kind, month, company);
    if (!state.draft) state.draft = copy(kind === 'lanc' ? getLanc(month, company) : getPlan(month, company));
    if (kind === 'plan' && key === 'custo_total') {
      state.draft.custos_diretos_p = parseValorBR(value); PLAN_CUSTO_CAMPOS.slice(1).forEach(name => { state.draft[name] = 0; });
    } else state.draft[key] = ['obs', 'pagador', 'meio_pagamento'].includes(key) ? String(value) : key.startsWith('headcount') ? parseInt(value) || 0 : parseValorBR(value);
    state.revision++; scheduleManual(state);
    if (kind === 'lanc') updateLancResult();
  }
  updateLanc = (key, value) => updateManual('lanc', selMonth, selCompany, key, value);
  updateEmpresaLanc = (company, key, value) => updateManual('lanc', selEmpresaMonth, company, key, value);
  updatePlan = (company, key, value) => updateManual('plan', selPlanMonth, company, key, value);
  function restoreManualDraftInputs() {
    const entry = manualSaves.get(manualKey('lanc', selMonth, selCompany));
    if (entry?.draft) for (const [name, value] of Object.entries(entry.draft)) { const input = byId('lanc-' + name); if (input) input.value = value; }
    const planTable = byId('plan-table');
    planTable?.querySelectorAll?.('input[oninput]').forEach(input => {
      const match = (input.getAttribute('oninput') || '').match(/^updatePlan\('([^']+)','([^']+)'/);
      if (!match) return;
      const state = manualSaves.get(manualKey('plan', selPlanMonth, match[1]));
      if (state?.draft) input.value = match[2] === 'custo_total' ? getCustoPlanTotal(state.draft) : state.draft[match[2]] ?? '';
    });
    for (const kind of ['lanc', 'plan']) {
      const page = kind === 'lanc' ? 'lancamentos' : 'planejado', id = 'ops-manual-' + kind + '-state';
      const container = byId('tab-' + page); if (!container || !document.createElement) continue;
      let box = byId(id); if (!box) { box = document.createElement('div'); box.id = id; box.setAttribute('role', 'status'); container.appendChild(box); }
      box.replaceChildren();
      const states = [...manualSaves.values()].filter(state => state.epoch === painelEpoch && state.kind === kind && state.draft && (kind === 'lanc' ? state.month === selMonth && state.company === selCompany : state.month === selPlanMonth));
      for (const state of states) {
        const row = document.createElement('p'); row.style.cssText = 'font-size:12px;color:' + (state.error ? '#B91C1C' : '#475569');
        row.textContent = (COMPANIES.find(company => company.id === state.company)?.name || state.company) + ' / ' + state.month + ': rascunho ' + (state.error ? 'não confirmado. ' : 'aguardando confirmação. ') + 'Os totais usam somente valores confirmados.';
        if (state.error) {
          const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Tentar novamente';
          retry.addEventListener('click', () => { scheduleManual(state); flushManual(state); }); row.appendChild(retry);
        }
        box.appendChild(row);
      }
    }
  }
  const originalRenderManualPlans = renderPlanejado;
  renderPlanejado = function () {
    const focusHandler = document.activeElement?.getAttribute?.('oninput');
    originalRenderManualPlans(); restoreManualDraftInputs();
    if (focusHandler?.startsWith('updatePlan(')) byId('plan-table')?.querySelectorAll?.('input[oninput]').forEach(input => { if (input.getAttribute('oninput') === focusHandler) input.focus?.({ preventScroll: true }); });
  };

  const structureSaves = new Map();
  async function flushStructure(epoch = painelEpoch) {
    const state = structureSaves.get(epoch);
    if (!state || !current(epoch)) return;
    if (state.running) return state.running;
    clearTimeout(state.timer); state.timer = null;
    state.running = (async () => {
      while (state.pending && current(epoch)) {
        const snapshot = state.pending; state.pending = null;
        try {
          const id = snapshot.id || estrutura_id;
          const saved = await confirmed(id
            ? sb.from('estrutura').update(snapshot.payload).eq('id', id).select('id').single()
            : sb.from('estrutura').insert(snapshot.payload).select('id').single(), 'salvar estrutura');
          if (!current(epoch)) return;
          if (!saved.id) throw new Error('O servidor não confirmou a identificação do orçamento.');
          estrutura_id = saved.id;
          confirmStructureAportes(snapshot.payload);
          state.failed = null;
          if (!state.pending) { repaintConfirmedStructure(); statusFor('tab-estrutura', 'saved', 'Orçamento salvo no servidor.'); showSaving('saving-estr'); }
        } catch (error) {
          if (!current(epoch)) return;
          state.failed = snapshot;
          statusFor('tab-estrutura', 'error', 'Orçamento não confirmado. Suas alterações foram mantidas. Use Salvar tudo para tentar novamente.');
          notifyError(error);
          if (!state.pending) break;
        }
      }
    })();
    try { return await state.running; } finally { state.running = null; }
  }
  saveEstrutura = function (source) {
    if (source?.dataset?.meta) document.querySelectorAll('[data-meta="' + source.dataset.meta + '"]').forEach(element => { if (element !== source) element.value = source.value; });
    const epoch = painelEpoch;
    const metas = { ...(estrutura.metas || {}), runway: metaVal('runway', 6), margem: metaVal('margem', 0.15), burnRateMax: metaVal('burnRateMax', 0) };
    if (source?.dataset?.meta && ['runway', 'margem', 'burnRateMax'].includes(source.dataset.meta)) {
      const value = Number(source.value); if (Number.isFinite(value)) metas[source.dataset.meta] = value;
    }
    estrutura.metas = metas;
    const payload = JSON.parse(JSON.stringify({ caixa_inicial: estrutura.caixa_inicial || 0, ano: EXERCICIO, data_inicio: DATA_INICIO.label,
      investimento: estrutura.investimento, custos_mensais: estrutura.custos_mensais, custos_por_mes: estrutura.custos_por_mes, aportes: estrutura.aportes,
      metas, updated_at: new Date().toISOString() }));
    let state = structureSaves.get(epoch);
    if (!state) { state = { timer: null, pending: null, running: null, failed: null }; structureSaves.set(epoch, state); }
    state.pending = { id: estrutura_id, payload }; clearTimeout(state.timer);
    statusFor('tab-estrutura', 'pending', 'Orçamento em edição; aguardando confirmação do servidor...');
    state.timer = setTimeout(() => flushStructure(epoch), 600);
  };

  let saveAllSequence = 0;
  salvarTudoAgora = async function () {
    const epoch = painelEpoch, lease = epoch + ':save-all';
    if (writes.has(lease)) return;
    const sequence = ++saveAllSequence, button = byId('btn-salvar-tudo'), original = button?.innerHTML || 'Salvar tudo';
    writes.add(lease);
    if (button) { button.disabled = true; button.textContent = 'Confirmando alterações...'; button.dataset.saveState = 'pending'; }
    try {
      const states = [...manualSaves.values()].filter(state => current(state.epoch) && state.draft);
      for (const state of states) {
        clearTimeout(state.timer);
        if (!state.pending && !state.running) scheduleManual(state);
      }
      const structure = structureSaves.get(epoch);
      const structureDirty = Boolean(structure && (structure.pending || structure.failed || structure.running));
      if (structure) { clearTimeout(structure.timer); if (!structure.pending && !structure.running && structure.failed) structure.pending = structure.failed; }
      // Only dirty snapshots are written; previously loaded rows are never replayed wholesale.
      await Promise.all([...states.map(flushManual), ...(structureDirty ? [flushStructure(epoch)] : [])]);
      if (!current(epoch)) return;
      const remaining = [...manualSaves.values()].some(state => current(state.epoch) && state.draft)
        || Boolean(structure?.pending || structure?.failed || structure?.running);
      if (button) { button.dataset.saveState = remaining ? 'error' : 'saved'; button.textContent = remaining ? 'Há rascunhos não confirmados — tentar novamente' : states.length || structureDirty ? 'Alterações financeiras confirmadas' : 'Nenhuma alteração pendente'; }
    } catch (error) {
      if (current(epoch)) { if (button) { button.dataset.saveState = 'error'; button.textContent = 'Falha ao confirmar — tentar novamente'; } notifyError(error); }
    } finally {
      writes.delete(lease);
      if (current(epoch) && button) {
        button.disabled = false;
        setTimeout(() => { if (current(epoch) && saveAllSequence === sequence) button.innerHTML = original; }, 2800);
      }
    }
  };

  const originalRenderAll = renderAll;
  renderAll = function () { return preserveDrafts(() => originalRenderAll()); };
  const originalRenderCompany = renderEmpresaIndividual;
  renderEmpresaIndividual = function (id) {
    if (id !== currentEmpresaId) return originalRenderCompany(id);
    return preserveDrafts(() => originalRenderCompany(id));
  };
  const originalRenderEntries = renderLancamentos;
  renderLancamentos = function () {
    const form = byId('lanc-custo-extra-form');
    const scope = form?.dataset?.opsScope;
    if (!preserving && form && form.style.display !== 'none' && scope && scope !== selCompany + ':' + selMonth && byId('ce-descricao')?.value.trim()) {
      if (!confirm('Trocar empresa ou mês descarta o custo em edição. Continuar?')) {
        const parts = scope.split(':'); selCompany = parts[0]; selMonth = parts[1];
      }
    }
    return preserveDrafts(() => {
      const result = originalRenderEntries();
      if (byId('lanc-form')) byId('lanc-form').dataset.opsScope = selCompany + ':' + selMonth;
      return result;
    });
  };
  const originalShowCompany = showEmpresaIndividual;
  showEmpresaIndividual = function (id, button) {
    const form = byId('plano-form');
    if (id !== currentEmpresaId && form && form.style.display !== 'none' && byId('plano-nome')?.value.trim() &&
      !confirm('Trocar de projeto descarta o plano em edição. Continuar?')) return;
    return originalShowCompany(id, button);
  };
  const originalOpenCost = abrirFormCustoExtra;
  abrirFormCustoExtra = function (id) {
    originalOpenCost(id);
    const form = byId('lanc-custo-extra-form');
    if (form) {
      form.dataset.opsScope = selCompany + ':' + selMonth;
      if (!id) delete form.dataset.recorrenciaId;
      statusFor('lanc-custo-extra-form', 'draft', 'Rascunho ainda não salvo.');
      mountGatewayField(id);
    }
  };

  function mountGatewayField(id) {
    const form = byId('lanc-custo-extra-form');
    if (!form || !document.createElement || typeof recibosFinanceiros !== 'function') return;
    let field = byId('ce-gateway-ref');
    if (!field) {
      const label = document.createElement('label');
      label.style.cssText = 'display:block;font-size:12px;margin-top:10px;color:#475569;';
      label.textContent = 'Taxa de recebimento vinculada (opcional)';
      field = document.createElement('select'); field.id = 'ce-gateway-ref';
      field.style.cssText = 'display:block;width:100%;max-width:600px;padding:8px;margin-top:5px;';
      label.appendChild(field); form.appendChild(label);
      field.addEventListener('change', () => {
        const receipt = recibosFinanceiros().find(item => item.ref === field.value && item.company === selCompany);
        if (receipt) {
          byId('ce-categoria').value = 'Taxas de pagamento'; byId('ce-tipo').value = 'variavel';
          byId('ce-valor').value = Number(receipt.fee).toFixed(2);
          if (!byId('ce-descricao').value.trim()) byId('ce-descricao').value = 'Taxa de pagamento — ' + receipt.provider;
        }
      });
    }
    field.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Sem vínculo — custo independente'; field.appendChild(empty);
    const rows = recibosFinanceiros().filter(item => item.company === selCompany && item.row?.status === 'approved' && item.currency === 'BRL' && Number(item.fee) > 0 &&
      item.date && new Date(item.date).getFullYear() === EXERCICIO && MONTHS[new Date(item.date).getMonth()] === selMonth);
    for (const receipt of rows) {
      const option = document.createElement('option'); option.value = receipt.ref;
      option.textContent = receipt.provider + ' · ' + new Date(receipt.date).toLocaleDateString('pt-BR') + ' · taxa ' + fmt(receipt.fee);
      field.appendChild(option);
    }
    field.value = custosExtras.find(item => String(item.id) === String(id))?.gateway_receipt_ref || '';
  }
  const originalOpenPlan = abrirFormPlano, originalEditPlan = editarPlano;
  abrirFormPlano = function (cid) { originalOpenPlan(cid); if (byId('plano-form')) byId('plano-form').dataset.opsScope = cid; };
  editarPlano = function (cid, id) { originalEditPlan(cid, id); if (byId('plano-form')) byId('plano-form').dataset.opsScope = cid; };

  saveCustoExtra = async function (cost) {
    const epoch = painelEpoch;
    const payload = {
      mes: cost.mes, ano: EXERCICIO, empresa_id: cost.empresa_id,
      categoria: cost.categoria || 'Outros Custos', tipo: cost.tipo === 'fixo' ? 'fixo' : 'variavel',
      recorrencia_id: cost.recorrencia_id || null, descricao: cost.descricao || '',
      valor: Number(cost.valor), pagador: cost.pagador || '', meio_pagamento: cost.meio_pagamento || '',
      gateway_receipt_ref: cost.gateway_receipt_ref || null,
      updated_at: new Date().toISOString(),
    };
    if (!knownCompany(payload.empresa_id) || !MONTHS.includes(payload.mes) || !Number.isFinite(payload.valor) || payload.valor <= 0) {
      throw new Error('Confira empresa, mês e valor do custo antes de salvar.');
    }
    const request = cost.id
      ? sb.from('custos_extras').update(payload).eq('id', cost.id).select('*').single()
      : sb.from('custos_extras').insert(payload).select('*').single();
    const saved = await confirmed(request, cost.id ? 'atualizar custo' : 'salvar custo');
    if (!current(epoch)) return null;
    if (!saved.id) throw new Error('O servidor não confirmou a identificação do custo.');
    Object.assign(cost, saved);
    showSaving('saving-lanc');
    return saved;
  };

  criarCustoFixoRecorrente = async function (base, initialMonth, company = selCompany) {
    const epoch = painelEpoch, year = EXERCICIO;
    const start = MONTHS.indexOf(initialMonth), end = Math.max(start, new Date().getMonth());
    if (start < 0 || !knownCompany(company)) throw new Error('Empresa ou mês da recorrência inválido.');
    const form = byId('lanc-custo-extra-form');
    const rid = base.recorrencia_id || form?.dataset?.recorrenciaId ||
      (globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
        const value = Math.floor(Math.random() * 16); return (char === 'x' ? value : ((value & 3) | 8)).toString(16);
      }));
    if (form) form.dataset.recorrenciaId = rid;
    const result = await db(sb.from('custos_extras').select('*').eq('recorrencia_id', rid).eq('empresa_id', company).eq('ano', year), 'conferir recorrência');
    if (!current(epoch)) return 0;
    const existing = Array.isArray(result.data) ? result.data : [];
    for (const saved of existing) if (!custosExtras.some(item => String(item.id) === String(saved.id))) custosExtras.push(saved);
    let count = 0;
    try {
      for (let index = start; index <= end; index++) {
        if (!current(epoch)) return count;
        const month = MONTHS[index];
        if (existing.some(item => item.mes === month)) continue;
        const cost = { ...base, mes: month, empresa_id: company, tipo: 'fixo', recorrencia_id: rid };
        const saved = await saveCustoExtra(cost);
        if (!current(epoch)) return count;
        if (saved && !custosExtras.some(item => String(item.id) === String(saved.id))) custosExtras.push(saved);
        count++;
      }
    } catch (error) {
      error.message = 'A recorrência foi interrompida após ' + count + ' mês(es) confirmado(s). Tente novamente para completar os meses restantes. ' + (error.message || '');
      throw error;
    }
    return count;
  };

  async function saveCostForm(another) {
    const epoch = painelEpoch, company = selCompany, month = selMonth;
    const lease = epoch + ':cost';
    if (writes.has(lease)) return;
    const form = byId('lanc-custo-extra-form');
    const base = {
      categoria: byId('ce-categoria').value, tipo: byId('ce-tipo').value,
      descricao: byId('ce-descricao').value.trim(), valor: parseValorBR(byId('ce-valor').value),
      pagador: byId('ce-pagador').value, meio_pagamento: byId('ce-meio').value,
      gateway_receipt_ref: byId('ce-gateway-ref')?.value || null,
    };
    if (!base.descricao || !Number.isFinite(base.valor) || base.valor <= 0) { alert('Preencha a descrição e um valor maior que zero.'); return; }
    if (base.gateway_receipt_ref) {
      const receipt = typeof recibosFinanceiros === 'function' ? recibosFinanceiros().find(item => item.ref === base.gateway_receipt_ref && item.company === company) : null;
      if (!receipt || Math.round(Number(receipt.fee) * 100) !== Math.round(base.valor * 100)) {
        statusFor('lanc-custo-extra-form', 'error', 'A taxa vinculada precisa corresponder ao valor confirmado do recebimento. Para outro custo, remova o vínculo.'); return;
      }
      base.categoria = 'Taxas de pagamento';
      base.tipo = 'variavel';
    }
    writes.add(lease); statusFor('lanc-custo-extra-form', 'pending', 'Salvando. Aguarde a confirmação...');
    try {
      const id = form.dataset.editId;
      if (id) {
        const previous = custosExtras.find(item => String(item.id) === String(id));
        if (!previous) throw new Error('O custo não está mais disponível. Recarregue os lançamentos.');
        const saved = await saveCustoExtra({ ...previous, ...base });
        if (!current(epoch)) return;
        custosExtras = custosExtras.map(item => String(item.id) === String(id) ? saved : item);
      } else if (base.tipo === 'fixo') {
        await criarCustoFixoRecorrente(base, month, company);
      } else {
        const saved = await saveCustoExtra({ ...base, mes: month, empresa_id: company });
        if (!current(epoch)) return;
        if (saved) custosExtras.push(saved);
      }
      if (!current(epoch)) return;
      statusFor('lanc-custo-extra-form', 'saved', 'Salvo no servidor.');
      if (company !== selCompany || month !== selMonth) { toast('Custo confirmado em ' + company + ' / ' + month + '.'); renderAll(); return; }
      if (!another) fecharFormCustoExtra();
      renderAll();
      if (another) {
        ['ce-descricao', 'ce-valor', 'ce-pagador', 'ce-meio', 'ce-gateway-ref'].forEach(id => { if (byId(id)) byId(id).value = ''; });
        delete byId('lanc-custo-extra-form').dataset.editId;
        delete byId('lanc-custo-extra-form').dataset.recorrenciaId;
        byId('ce-descricao')?.focus();
        statusFor('lanc-custo-extra-form', 'saved', 'Custo salvo. Você pode lançar o próximo.');
      }
    } catch (error) {
      if (!current(epoch)) return;
      statusFor('lanc-custo-extra-form', 'error', error.message || 'Falha na gravação. O rascunho foi mantido.');
      notifyError(error);
    } finally { writes.delete(lease); }
  }
  salvarCustoExtra = () => saveCostForm(false);
  salvarELancarOutro = () => saveCostForm(true);

  function calendarCompanies() { return COMPANIES.filter(company => empresasAcessiveis?.has(company.id)); }
  const calendarProjectName = id => !id ? 'Sem projeto vinculado' : calendarCompanies().find(company => company.id === id)?.name || 'Projeto sem acesso de edição';
  let calendarBaseline = '';
  const calendarDraftValue = () => JSON.stringify({ fields: ['cal-modal-id', 'cal-modal-data', 'cal-modal-titulo', 'cal-modal-descricao', 'cal-modal-status', 'cal-modal-dias', 'cal-modal-empresa'].map(id => byId(id)?.value || ''), owners: getCalModalResps().slice().sort() });
  const originalCloseCalendar = closeCalModal;
  closeCalModal = function (saved = false) {
    if (saved !== true && calendarBaseline && calendarDraftValue() !== calendarBaseline && !confirm('Descartar as alterações desta ação do calendário?')) return;
    calendarBaseline = ''; return originalCloseCalendar();
  };
  const originalOpenCalendar = openCalModal;
  openCalModal = function (id, date) {
    if (calendarBaseline && calendarDraftValue() !== calendarBaseline && !confirm('Abrir outra ação descarta as alterações atuais. Continuar?')) return;
    originalOpenCalendar(id, date);
    const container = byId('cal-modal-titulo')?.parentNode;
    if (!container || !document.createElement) return;
    let field = byId('cal-modal-empresa');
    if (!field) {
      const label = document.createElement('label'); label.textContent = 'Projeto (opcional)';
      field = document.createElement('select'); field.id = 'cal-modal-empresa'; label.appendChild(field);
      container.insertBefore(label, byId('cal-modal-descricao'));
    }
    field.replaceChildren();
    const selected = acoesCal.find(action => String(action.id) === String(id))?.empresa_id || '';
    const options = [{ id: '', name: 'Sem projeto vinculado' }, ...calendarCompanies()];
    if (selected && !options.some(company => company.id === selected)) options.push({ id: selected, name: 'Projeto sem acesso de edição' });
    for (const company of options) {
      const option = document.createElement('option'); option.value = company.id; option.textContent = company.name; field.appendChild(option);
    }
    field.value = selected;
    calendarBaseline = calendarDraftValue();
  };
  saveCalModal = async function () {
    const epoch = painelEpoch, id = byId('cal-modal-id').value;
    const lease = epoch + ':calendar';
    if (writes.has(lease)) return;
    const payload = {
      data: byId('cal-modal-data').value, titulo: byId('cal-modal-titulo').value.trim(),
      descricao: byId('cal-modal-descricao').value.trim(), responsavel: getCalModalResps(),
      status: byId('cal-modal-status').value, dias_execucao: Math.max(1, parseInt(byId('cal-modal-dias').value) || 1),
      empresa_id: byId('cal-modal-empresa')?.value || null,
      updated_at: new Date().toISOString(),
    };
    if (!payload.titulo || !/^\d{4}-\d{2}-\d{2}$/.test(payload.data)) { alert('Informe título e data da ação.'); return; }
    writes.add(lease);
    statusFor('cal-modal-overlay', 'pending', 'Salvando ação...');
    try {
      const request = id ? sb.from('calendario_acoes').update(payload).eq('id', id).select('*').single()
        : sb.from('calendario_acoes').insert({ ...payload, ordem: acoesCal.filter(action => action.data === payload.data).length }).select('*').single();
      const saved = await confirmed(request, 'salvar ação');
      if (!current(epoch)) return;
      if (id) acoesCal = acoesCal.map(action => String(action.id) === String(id) ? saved : action);
      else acoesCal.push(saved);
      closeCalModal(true); renderCalendario(); toast('Ação salva.');
    } catch (error) {
      if (current(epoch)) { statusFor('cal-modal-overlay', 'error', 'Não foi possível salvar. Seu rascunho foi mantido.'); notifyError(error); }
    } finally { writes.delete(lease); }
  };

  calDrop = async function (event, targetDate) {
    event.preventDefault();
    const id = calDraggingId, epoch = painelEpoch;
    const lease = epoch + ':calendar:' + id;
    const action = acoesCal.find(item => String(item.id) === String(id));
    if (!action || action.data === targetDate || writes.has(lease)) return;
    writes.add(lease);
    try {
      const saved = await confirmed(sb.from('calendario_acoes').update({ data: targetDate, updated_at: new Date().toISOString() }).eq('id', id).select('*').single(), 'mover ação');
      if (!current(epoch)) return;
      acoesCal = acoesCal.map(item => String(item.id) === String(id) ? saved : item);
      renderCalendario();
    } catch (error) { if (current(epoch)) { notifyError(error); renderCalendario(); } }
    finally { writes.delete(lease); }
  };

  salvarPlano = async function (cid) {
    const epoch = painelEpoch, id = byId('plano-id').value;
    const lease = epoch + ':plan';
    if (writes.has(lease)) return;
    const payload = { empresa_id: cid, nome: byId('plano-nome').value.trim(),
      preco_venda: parseValorBR(byId('plano-venda').value), custo: parseValorBR(byId('plano-custo').value),
      limite: byId('plano-limite').value.trim() || null, obs: byId('plano-obs').value.trim() || null };
    if (!knownCompany(cid) || !payload.nome || !Number.isFinite(payload.preco_venda) || !Number.isFinite(payload.custo) || payload.preco_venda < 0 || payload.custo < 0) {
      text('plano-feedback', 'Confira o nome e os valores do plano.'); return;
    }
    writes.add(lease); text('plano-feedback', 'Salvando...');
    try {
      const saved = await confirmed(id
        ? sb.from('planos_empresas').update(payload).eq('id', id).select('*').single()
        : sb.from('planos_empresas').insert({ ...payload, ordem: getPlanosEmpresa(cid).length + 1 }).select('*').single(), 'salvar plano');
      if (!current(epoch)) return;
      if (id) planosEmpresas = planosEmpresas.map(plan => String(plan.id) === String(id) ? saved : plan);
      else planosEmpresas.push(saved);
      if (currentEmpresaId === cid) { fecharFormPlano(); renderEmpresaIndividual(cid); }
      toast('Plano salvo.');
    } catch (error) { if (current(epoch)) { text('plano-feedback', 'Não foi possível salvar. Seu rascunho foi mantido.'); notifyError(error); } }
    finally { writes.delete(lease); }
  };

  // A real cancel is distinct from cancelling the choice between month and series.
  deleteCustoExtra = async function (id) {
    const epoch = painelEpoch, lease = epoch + ':delete-cost:' + id;
    const item = custosExtras.find(cost => String(cost.id) === String(id));
    if (!item || writes.has(lease)) return;
    let wholeSeries = false;
    if (item.recorrencia_id) {
      const answer = prompt('Excluir custo recorrente: digite MES para excluir só este mês, SERIE para excluir toda a série, ou cancele.');
      if (answer === null) return;
      const choice = answer.trim().toUpperCase();
      if (!['MES', 'SERIE'].includes(choice)) { alert('Nenhum custo excluído. Escolha MES ou SERIE.'); return; }
      wholeSeries = choice === 'SERIE';
    } else if (!confirm('Excluir este custo?')) return;
    writes.add(lease);
    try {
      let request = sb.from('custos_extras').delete();
      request = wholeSeries ? request.eq('recorrencia_id', item.recorrencia_id).eq('empresa_id', item.empresa_id).eq('ano', EXERCICIO) : request.eq('id', id);
      const removed = await confirmed(request.select('id'), 'excluir custo');
      if (!current(epoch)) return;
      const ids = new Set((Array.isArray(removed) ? removed : [removed]).map(cost => String(cost.id)));
      custosExtras = custosExtras.filter(cost => !ids.has(String(cost.id)));
      renderAll();
    } catch (error) { if (current(epoch)) notifyError(error); }
    finally { writes.delete(lease); }
  };

  async function removeConfirmed(table, id, list, apply, render, page) {
    const epoch = painelEpoch, lease = epoch + ':delete:' + table + ':' + id;
    if (writes.has(lease) || !list.some(item => String(item.id) === String(id))) return;
    writes.add(lease);
    try {
      const removed = await confirmed(sb.from(table).delete().eq('id', id).select('id'), 'excluir registro');
      if (!current(epoch)) return;
      const ids = new Set((Array.isArray(removed) ? removed : [removed]).map(item => String(item.id)));
      if (!ids.has(String(id))) throw new Error('O servidor não confirmou a exclusão deste registro.');
      apply(ids); issues.delete('delete:' + table + ':' + id); render(); toast('Registro excluído.');
    } catch (error) {
      if (current(epoch)) { issues.set('delete:' + table + ':' + id, { id, page, message: 'Uma exclusão não foi confirmada. O registro anterior foi mantido; tente novamente.' }); notifyError(error); }
    } finally { writes.delete(lease); }
  }
  deleteCalAcao = async function (id) {
    if (!confirm('Excluir somente esta ação do calendário?')) return;
    return removeConfirmed('calendario_acoes', id, acoesCal,
      ids => { acoesCal = acoesCal.filter(item => !ids.has(String(item.id))); }, () => renderCalendario(), 'calendario');
  };
  excluirPlano = async function (company, id) {
    if (!confirm('Excluir este plano?')) return;
    return removeConfirmed('planos_empresas', id, planosEmpresas,
      ids => { planosEmpresas = planosEmpresas.filter(item => !ids.has(String(item.id))); },
      () => { if (currentEmpresaId === company) renderEmpresaIndividual(company); }, 'empresa');
  };
  excluirContato = async function (id) {
    if (!confirm('Excluir esta mensagem?')) return;
    return removeConfirmed('contatos', id, contatos,
      ids => { contatos = contatos.filter(item => !ids.has(String(item.id))); }, () => renderContatos(), 'contatos');
  };

  let calendarProjectFilter = 'all';
  const calendarInProject = action => calendarProjectFilter === 'all' || (calendarProjectFilter === 'unlinked' ? !action.empresa_id : action.empresa_id === calendarProjectFilter);
  function resumoCalendario(now = calTodayISO()) {
    const end = calAddDays(now, 6);
    const pending = acoesCal.filter(action => action.status !== 'done' && calendarInProject(action));
    const upcoming = pending.filter(action => action.data <= end && calDeadline(action) >= now);
    const overdue = pending.filter(action => calDeadline(action) < now);
    const owners = {}, projects = {};
    for (const action of upcoming) {
      for (const owner of calNormResp(action.responsavel)) owners[owner] = (owners[owner] || 0) + 1;
      const project = calendarProjectName(action.empresa_id); projects[project] = (projects[project] || 0) + 1;
    }
    return { upcoming: upcoming.length, overdue: overdue.length, unassigned: pending.filter(action => !calNormResp(action.responsavel).length).length, owners, projects };
  }

  // Seven local dates include today; the inherited quick filter used eight dates.
  const originalCalendarFilter = calPassesFilter, originalCalendarCounts = updateCalFilterCounts;
  calPassesFilter = function (action) {
    return calendarInProject(action) && originalCalendarFilter(action) && (calFilters.quick !== 'semana' || action.data <= calAddDays(calTodayISO(), 6));
  };
  updateCalFilterCounts = function () {
    originalCalendarCounts();
    const actions = acoesCal.filter(calendarInProject), today = calTodayISO();
    for (const status of ['todo', 'doing', 'done']) text('cal-count-' + status, actions.filter(action => (action.status || 'todo') === status).length);
    text('cal-count-vencidas', actions.filter(calIsOverdue).length);
    text('cal-count-hoje', actions.filter(action => action.status !== 'done' && action.data <= today && calDeadline(action) >= today).length);
    text('cal-count-semana', resumoCalendario().upcoming);
    for (const owner of CAL_EXECUTORES) text('cal-fp-count-' + owner.nome, actions.filter(action => calNormResp(action.responsavel).includes(owner.nome)).length);
  };
  const originalClearCalendarFilters = clearCalFilters;
  clearCalFilters = function () { calendarProjectFilter = 'all'; return originalClearCalendarFilters(); };

  const originalCalendar = renderCalendario;
  renderCalendario = function () {
    originalCalendar();
    const board = byId('cal-board');
    if (!board?.parentNode || !document.createElement) return;
    let box = byId('ops-calendar-summary');
    if (!box) { box = document.createElement('div'); box.id = 'ops-calendar-summary'; board.parentNode.insertBefore(box, board); }
    const summary = resumoCalendario();
    box.style.cssText = 'font-size:12px;padding:12px;margin-bottom:12px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;';
    box.replaceChildren();
    const projectLabel = document.createElement('label'); projectLabel.textContent = 'Filtrar projeto '; box.appendChild(projectLabel);
    const projectFilter = document.createElement('select'); projectLabel.appendChild(projectFilter);
    for (const company of [{ id: 'all', name: 'Todos os projetos' }, { id: 'unlinked', name: 'Sem projeto vinculado' }, ...calendarCompanies()]) {
      const option = document.createElement('option'); option.value = company.id; option.textContent = company.name; projectFilter.appendChild(option);
    }
    projectFilter.value = calendarProjectFilter; projectFilter.addEventListener('change', () => { calendarProjectFilter = projectFilter.value; renderCalendario(); });
    const heading = document.createElement('p');
    heading.textContent = summary.upcoming + ' ação(ões) nos próximos 7 dias (inclui hoje) · ' + summary.overdue + ' vencida(s) · ' + summary.unassigned + ' sem responsável';
    box.appendChild(heading);
    const workload = document.createElement('p');
    workload.textContent = 'Carga nos próximos 7 dias por responsável: ' + (Object.keys(summary.owners).length ? Object.entries(summary.owners).map(([owner, count]) => owner + ' ' + count).join(', ') : 'nenhuma ação atribuída.')
      + ' · Por projeto: ' + (Object.entries(summary.projects).map(([name, count]) => name + ' ' + count).join(', ') || 'nenhuma ação.');
    box.appendChild(workload);
    const today = calTodayISO(), end = calAddDays(today, 6);
    const actions = acoesCal.filter(action => calendarInProject(action) && action.status !== 'done' && (calDeadline(action) < today || (action.data <= end && calDeadline(action) >= today) || !calNormResp(action.responsavel).length))
      .sort((left, right) => calDeadline(left).localeCompare(calDeadline(right)));
    const caption = document.createElement('p'); caption.textContent = 'Abrir ação para revisar (até 10, por prazo):'; box.appendChild(caption);
    for (const action of actions.slice(0, 10)) {
      const button = document.createElement('button'); button.type = 'button'; button.style.cssText = 'margin:3px;padding:5px 8px;';
      button.textContent = (calDeadline(action) < today ? 'Atrasada · ' : '') + action.titulo + ' · ' + calendarProjectName(action.empresa_id) + ' · ' + calDeadline(action);
      button.addEventListener('click', () => openCalModal(action.id)); box.appendChild(button);
    }
    if (!actions.length) caption.textContent = 'Nenhuma pendência nesta janela.';
  };

  const originalPlansSection = buildPlanosSection;
  buildPlanosSection = function (cid) {
    const html = originalPlansSection(cid).replace('<th style="text-align:right;">Líquido</th>', '<th style="text-align:right;">Resultado estimado</th>')
      .replace('<th style="text-align:right;">Margem</th>', '<th style="text-align:right;">Margem estimada</th>');
    const months = typeof DashboardFinance !== 'undefined' ? DashboardFinance.monthsToDate() : MONTHS_OPERACIONAIS.filter(month => MONTHS.indexOf(month) <= new Date().getMonth());
    const rows = typeof recibosFinanceiros === 'function' ? recibosFinanceiros().filter(item => item.company === cid && item.currency === 'BRL' && item.row?.status === 'approved' &&
      item.date && new Date(item.date).getFullYear() === EXERCICIO && months.includes(MONTHS[new Date(item.date).getMonth()])) : [];
    const known = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    const sum = name => rows.reduce((total, item) => total + (known(item[name]) ? Number(item[name]) : 0), 0);
    const confirmed = name => rows.every(item => known(item[name])) ? fmt(sum(name)) : 'não confirmado (' + rows.filter(item => !known(item[name])).length + ' recebimento(s) sem informação)';
    const period = months.length ? months[0] + '–' + months.at(-1) + '/' + EXERCICIO : String(EXERCICIO) + ' (sem meses operacionais decorridos)';
    return html + '<p style="font-size:12px;color:#64748B;margin:-10px 0 20px;">Estimativa comercial = venda menos custo cadastrado. Taxas e impostos só estão incluídos se fizerem parte desse custo. '
      + (rows.length ? 'Recebimentos aprovados da empresa em ' + period + ': bruto ' + fmt(sum('gross')) + ', taxas ' + confirmed('fee') + ', líquido ' + confirmed('net') + '. Esses recebimentos não foram atribuídos a planos individuais.' : 'Não há recebimentos aprovados vinculados em ' + period + ' para comparar com a estimativa.') + '</p>';
  };

  const draftPrefix = 'arcadehub-email-draft:v1:';
  const draftKey = () => emailOwner && emailMailboxId ? draftPrefix + emailOwner + ':' + emailMailboxId : '';
  function readEmailDraft() {
    try {
      const key = draftKey(), raw = key && window.sessionStorage?.getItem(key);
      const value = raw ? JSON.parse(raw) : null;
      return value && value.user === emailOwner && value.mailbox === emailMailboxId && typeof value.body === 'string' ? value : null;
    } catch (_) { return null; }
  }
  function clearEmailDraft(key = draftKey()) {
    try { if (key) window.sessionStorage?.removeItem(key); } catch (_) { /* storage may be disabled */ }
  }
  function saveEmailDraft(attempted = false) {
    const key = draftKey();
    if (!key || emailDraftMailbox !== emailMailboxId) return;
    if (!temRascunhoEmail()) { clearEmailDraft(key); return; }
    const previous = readEmailDraft();
    const value = { user: emailOwner, mailbox: emailMailboxId, to: byId('email-to').value,
      cc: byId('email-cc').value, subject: byId('email-subject').value, body: byId('email-body').value,
      replyId: emailReplyId, quote: emailReplyQuoteText, attempted: attempted || previous?.attempted === true, savedAt: new Date().toISOString() };
    try {
      window.sessionStorage?.setItem(key, JSON.stringify(value));
      if (!emailSending) text('ops-email-draft-info', 'Rascunho salvo nesta sessão do navegador.');
    } catch (_) { text('ops-email-draft-info', 'O navegador não permitiu salvar o rascunho nesta sessão.'); }
  }
  function limparDraftsDaSessao() {
    try {
      const storage = window.sessionStorage;
      if (!storage) return;
      const ownerPrefix = draftPrefix + emailOwner + ':';
      for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index);
        if (key && key.startsWith(ownerPrefix)) storage.removeItem(key);
      }
    } catch (_) { /* local recovery is optional */ }
    emailOwner = ''; drafts.clear();
  }
  function recoverEmailDraft() {
    if (emailSending || !caixaEmailAtual()?.can_send) return;
    const draft = readEmailDraft();
    if (!draft || (temRascunhoEmail() && !confirm('Substituir o texto atual pelo rascunho salvo nesta sessão?'))) return;
    emailDraftMailbox = emailMailboxId;
    const values = { 'email-to': draft.to, 'email-cc': draft.cc, 'email-subject': draft.subject, 'email-body': draft.body };
    for (const [id, value] of Object.entries(values)) if (byId(id)) byId(id).value = typeof value === 'string' ? value : '';
    emailReplyId = draft.replyId ?? null; emailReplyQuoteText = typeof draft.quote === 'string' ? draft.quote : '';
    if (byId('email-compositor')) byId('email-compositor').style.display = 'block';
    if (byId('email-cc-row') && draft.cc) byId('email-cc-row').style.display = 'block';
    text('email-composer-title', emailReplyId === null ? 'Novo e-mail — rascunho recuperado' : 'Resposta — rascunho recuperado');
    text('email-reply-context', emailReplyId === null ? '' : 'Resposta vinculada à mensagem original desta caixa.');
    if (byId('email-reply-context')) byId('email-reply-context').style.display = emailReplyId === null ? 'none' : 'block';
    text('email-reply-quote-text', emailReplyQuoteText);
    if (byId('email-reply-quote-preview')) byId('email-reply-quote-preview').style.display = emailReplyId === null ? 'none' : 'block';
    text('email-feedback', draft.attempted ? 'Este rascunho participou de uma tentativa de envio. Confira Enviados antes de decidir enviar novamente.' : 'Rascunho recuperado. Revise antes de enviar.');
    renderCaixasEmail(); byId('email-body')?.focus();
  }
  const emailListState = { query: '', page: 0, pageSize: 20, pendingOnly: false, scope: '' };
  function emailSearchRows() {
    const query = emailListState.query.toLocaleLowerCase('pt-BR').trim();
    const answered = new Set(emails.filter(item => emailDaCaixa(item) && item.direcao !== 'in' && item.reply_to_id != null && item.status !== 'falha')
      .map(item => String(item.reply_to_id)));
    return emails.filter(item => emailDaCaixa(item) && (emailView === 'in' ? item.direcao === 'in' : item.direcao !== 'in'))
      .filter(item => !query || [item.assunto, item.de, item.para, item.corpo_texto].some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query)))
      .filter(item => !emailListState.pendingOnly || (item.direcao === 'in' && !answered.has(String(item.id))));
  }
  const originalEmails = renderEmails;
  renderEmails = function () {
    const scope = emailMailboxId + ':' + emailView;
    if (scope !== emailListState.scope) { emailListState.scope = scope; emailListState.page = 0; emailListState.query = ''; emailListState.pendingOnly = false; }
    const all = emails, rows = emailSearchRows(), pages = Math.max(1, Math.ceil(rows.length / emailListState.pageSize));
    emailListState.page = Math.min(emailListState.page, pages - 1);
    if (caixaEmailAtual() && !emailLoading && !emailAccountsError && !emailListError) emails = rows.slice(emailListState.page * emailListState.pageSize, (emailListState.page + 1) * emailListState.pageSize);
    try { originalEmails(); }
    finally { emails = all; updateEmailBadge(); }
    if (!rows.length && (emailListState.query || emailListState.pendingOnly) && byId('emails-list') && !emailLoading && !emailListError && !emailAccountsError) {
      byId('emails-list').textContent = 'Nenhuma mensagem corresponde à busca neste histórico carregado.';
    }
    mountEmailTools(rows.length, pages);
  };
  function mountEmailTools(count, pages) {
    const list = byId('emails-list');
    if (!list?.parentNode || !document.createElement) return;
    let toolbar = byId('ops-email-tools');
    if (!toolbar) {
      toolbar = document.createElement('div'); toolbar.id = 'ops-email-tools';
      toolbar.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px;font-size:12px;';
      toolbar.innerHTML = '<label>Buscar no histórico disponível <input id="ops-email-search" type="search" style="padding:8px;max-width:250px;"></label>'
        + '<button type="button" id="ops-email-prev">Anterior</button><span id="ops-email-page"></span><button type="button" id="ops-email-next">Próxima</button>'
        + '<label><input type="checkbox" id="ops-email-pending"> Sem resposta registrada</label>'
        + '<button type="button" id="ops-email-recover">Recuperar rascunho</button><button type="button" id="ops-email-discard">Descartar rascunho salvo</button>'
        + '<span id="ops-email-draft-info" role="status" style="width:100%;color:#64748B;"></span>';
      list.parentNode.insertBefore(toolbar, list);
      byId('ops-email-search').addEventListener('input', event => { emailListState.query = event.target.value; emailListState.page = 0; renderEmails(); });
      byId('ops-email-prev').addEventListener('click', () => { if (emailListState.page > 0) emailListState.page--; renderEmails(); });
      byId('ops-email-next').addEventListener('click', () => { emailListState.page++; renderEmails(); });
      byId('ops-email-pending').addEventListener('change', event => { emailListState.pendingOnly = event.target.checked; emailListState.page = 0; renderEmails(); });
      byId('ops-email-recover').addEventListener('click', recoverEmailDraft);
      byId('ops-email-discard').addEventListener('click', () => { if (confirm('Descartar o rascunho salvo desta caixa?')) { clearEmailDraft(); renderEmails(); } });
      for (const id of ['email-to', 'email-cc', 'email-subject', 'email-body']) byId(id)?.addEventListener('input', () => saveEmailDraft(false));
    }
    byId('ops-email-search').value = emailListState.query;
    byId('ops-email-prev').disabled = emailListState.page === 0;
    byId('ops-email-next').disabled = emailListState.page >= pages - 1;
    byId('ops-email-pending').checked = emailListState.pendingOnly;
    byId('ops-email-pending').disabled = emailView !== 'in';
    text('ops-email-page', 'Página ' + (emailListState.page + 1) + ' de ' + pages + ' · ' + count + ' mensagem(ns)');
    const draft = readEmailDraft();
    byId('ops-email-recover').disabled = !draft || emailSending;
    byId('ops-email-discard').disabled = !draft || emailSending;
    text('ops-email-draft-info', (draft ? 'Há um rascunho salvo nesta sessão. ' : '') + 'Busca/páginas abrangem o histórico carregado desta caixa (até 300 mensagens), não toda a Hostinger. “Sem resposta registrada” não detecta respostas fora deste histórico.');
  }
  const originalCancelEmail = cancelarCompositorEmail;
  cancelarCompositorEmail = function () {
    const key = draftKey(); originalCancelEmail();
    if (byId('email-compositor')?.style.display === 'none') clearEmailDraft(key);
  };
  const originalOpenEmail = abrirCompositor;
  abrirCompositor = function () {
    const oldKey = draftKey(), hadDraft = temRascunhoEmail(); originalOpenEmail();
    if (hadDraft && !temRascunhoEmail()) clearEmailDraft(oldKey);
    renderEmails();
  };
  const originalChangeMailbox = trocarCaixaEmail;
  trocarCaixaEmail = async function (id) {
    const oldMailbox = emailMailboxId, key = draftKey(), hadDraft = temRascunhoEmail();
    await originalChangeMailbox(id);
    if (hadDraft && oldMailbox !== emailMailboxId) clearEmailDraft(key);
  };
  const originalSendEmail = enviarEmail;
  enviarEmail = async function () {
    const key = draftKey(), epoch = painelEpoch;
    saveEmailDraft(true);
    await originalSendEmail();
    if (current(epoch) && !temRascunhoEmail()) clearEmailDraft(key);
  };
  const originalReplyEmail = responderEmail;
  responderEmail = async function (id) {
    const epoch = painelEpoch, mailbox = emailMailboxId;
    const message = emailVisivel(id);
    if (message && !(message.corpo_texto || message.corpo_html)) await carregarCorpoEmail(id);
    if (!current(epoch) || mailbox !== emailMailboxId) return;
    await originalReplyEmail(id);
    if (!emailReplyQuoteText && emailReplyId !== null) text('email-feedback', 'A resposta está vinculada, mas o conteúdo original não pôde ser carregado. A citação ficará sem histórico.');
    saveEmailDraft(false);
  };
  try {
    sb.auth.onAuthStateChange((event, session) => {
      emailIdentityVersion++;
      const owner = session?.user?.id || '';
      if (event === 'SIGNED_OUT' || (emailOwner && owner && owner !== emailOwner)) limparDraftsDaSessao();
      if (owner) emailOwner = owner;
    });
    const epoch = painelEpoch, version = emailIdentityVersion;
    sb.auth.getSession?.().then(result => { if (current(epoch) && version === emailIdentityVersion) emailOwner = result?.data?.session?.user?.id || ''; }).catch(() => {});
  } catch (_) { /* recovery stays disabled until an authenticated identity exists */ }

  window.limparDraftsDaSessao = limparDraftsDaSessao;

  function uuid() {
    return globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const value = Math.floor(Math.random() * 16); return (char === 'x' ? value : ((value & 3) | 8)).toString(16);
    });
  }
  async function backend(action, payload = {}) {
    const response = await sb.functions.invoke('dashboard-ops', { body: { action, ...payload } });
    let data = response.data;
    const error = response.error;
    if (error && !data && error.context) {
      try { data = await (error.context.clone ? error.context.clone() : error.context).json(); } catch (_) { /* fixed fallback below */ }
    }
    if (error || !data || data.ok !== true) {
      const failure = new Error(data?.error || 'Não foi possível concluir a operação. Tente novamente.');
      failure.conflictIds = data?.conflict_ids || [];
      throw failure;
    }
    return data;
  }
  const leadFields = 'id,empresa_id,nome,email,regiao,telefone,observacao,status,created_at,updated_at,responsavel,proxima_acao,proxima_acao_em,last_moved_at,contato_origem_id';
  const leadRequestIds = new Map();
  function localDateTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
  function normalizePhone(value) { return String(value || '').replace(/\D/g, ''); }
  function leadDuplicates(payload, id = null) {
    const email = normalizeEmail(payload.email), phone = normalizePhone(payload.telefone);
    return leads.filter(item => item.empresa_id === payload.empresa_id && String(item.id) !== String(id) &&
      ((email && normalizeEmail(item.email) === email) || (phone && normalizePhone(item.telefone) === phone)));
  }
  function mountLeadFields() {
    const form = byId('lead-form');
    if (!form || byId('lead-responsavel') || !document.createElement) return;
    const fields = document.createElement('div'); fields.id = 'ops-lead-fields';
    fields.style.cssText = 'display:grid;gap:8px;margin:12px 0;';
    fields.innerHTML = '<label>Responsável <input id="lead-responsavel" maxlength="120" placeholder="Pessoa responsável pelo acompanhamento"></label>'
      + '<label>Próxima ação <input id="lead-proxima-acao" maxlength="1000" placeholder="Ex.: revisar proposta com o cliente"></label>'
      + '<label>Prazo da próxima ação <input id="lead-proxima-acao-em" type="datetime-local"></label>';
    form.appendChild(fields);
    form.addEventListener('input', () => leadRequestIds.delete(leadEditId || 'new'));
  }
  function nextActionFromForm() {
    const local = byId('lead-proxima-acao-em')?.value;
    let deadline = null;
    if (local) { const value = new Date(local); if (!Number.isNaN(value.getTime())) deadline = value.toISOString(); }
    return { responsavel: byId('lead-responsavel')?.value.trim() || null,
      proxima_acao: byId('lead-proxima-acao')?.value.trim() || null, proxima_acao_em: deadline };
  }
  const originalClearLead = limparLeadForm;
  limparLeadForm = function () {
    originalClearLead(); leadRequestIds.delete('new');
    ['lead-responsavel', 'lead-proxima-acao', 'lead-proxima-acao-em'].forEach(id => { if (byId(id)) byId(id).value = ''; });
  };
  const originalFillLead = preencherFormLead;
  preencherFormLead = function (lead) {
    mountLeadFields(); originalFillLead(lead);
    if (byId('lead-responsavel')) byId('lead-responsavel').value = lead.responsavel || '';
    if (byId('lead-proxima-acao')) byId('lead-proxima-acao').value = lead.proxima_acao || '';
    if (byId('lead-proxima-acao-em')) byId('lead-proxima-acao-em').value = localDateTime(lead.proxima_acao_em);
  };
  const originalLeadHasDraft = leadFormTemRascunho;
  leadFormTemRascunho = function () {
    if (originalLeadHasDraft()) return true;
    const values = nextActionFromForm(), lead = leadEditId ? leads.find(item => item.id === leadEditId) : null;
    return Object.entries(values).some(([key, value]) => key === 'proxima_acao_em'
      ? (value ? new Date(value).getTime() : null) !== (lead?.[key] ? new Date(lead[key]).getTime() : null)
      : (value || '') !== (lead?.[key] || ''));
  };
  const originalSaveLead = salvarLead;
  const leadIntentVersions = new Map();
  const originalMoveLead = mudarStatusLead;
  mudarStatusLead = function (id, status) {
    leadIntentVersions.set(id, (leadIntentVersions.get(id) || 0) + 1);
    return originalMoveLead(id, status);
  };
  salvarLead = async function (event) {
    event.preventDefault();
    if (leadSalvando) return;
    const payload = lerLeadForm();
    if (!payload) return;
    Object.assign(payload, nextActionFromForm());
    const id = leadEditId, epoch = painelEpoch, leadEpoch = leadsEpoch, requestKey = id || 'new';
    const intentVersion = (leadIntentVersions.get(id) || 0) + 1;
    if (id) leadIntentVersions.set(id, intentVersion);
    if (leadDuplicates(payload, id).length) {
      text('lead-msg', 'Já há um lead neste projeto com o mesmo e-mail ou telefone. Revise o cadastro existente antes de criar outro.'); return;
    }
    const requestId = leadRequestIds.get(requestKey) || uuid(); leadRequestIds.set(requestKey, requestId);
    leadSalvando = true; if (event.submitter) event.submitter.disabled = true;
    text('lead-msg', 'Salvando com confirmação do servidor...');
    try {
      const persistLead = async () => {
        if (!current(epoch) || leadEpoch !== leadsEpoch) return;
        const result = await backend('save_lead', { id: id || undefined, request_id: requestId, lead: payload });
        if (!current(epoch) || leadEpoch !== leadsEpoch) return;
        if (!result.lead?.id) throw new Error('O servidor não confirmou o lead.');
        const saved = lembrarLead(result.lead);
        const index = leads.findIndex(item => String(item.id) === String(saved.id));
        if (index >= 0) {
          // Keep a drag initiated after this form save visible until its queued write is confirmed.
          if ((leadIntentVersions.get(id) || 0) > intentVersion) saved.status = leads[index].status;
          leads[index] = saved;
        } else leads.unshift(saved);
      };
      if (id) await enfileirarEscritaLead(id, persistLead); else await persistLead();
      if (!current(epoch) || leadEpoch !== leadsEpoch) return;
      issues.delete('leads'); leadRequestIds.delete(requestKey); limparLeadForm(); renderLeads(); toast('Lead salvo.');
    } catch (error) { if (current(epoch)) { issues.set('leads', { id: 'leads', page: 'leads', message: 'Há um lead com gravação não confirmada. Revise o formulário.' }); text('lead-msg', error.message); } }
    finally { if (current(epoch) && leadEpoch === leadsEpoch) { leadSalvando = false; if (event.submitter) event.submitter.disabled = false; } }
  };
  const leadForm = byId('lead-form');
  leadForm?.removeEventListener?.('submit', originalSaveLead);
  leadForm?.addEventListener?.('submit', event => salvarLead(event));
  byId('lead-cancel')?.removeEventListener?.('click', originalClearLead);
  byId('lead-cancel')?.addEventListener?.('click', () => limparLeadForm());
  const originalLeads = renderLeads;
  function leadWorkSummary(now = new Date()) {
    const allowed = new Set(empresasDeLead().map(company => company.id));
    const active = leads.filter(lead => allowed.has(lead.empresa_id) && lead.empresa_id === selLeadCompany && !['ganho', 'perdido'].includes(lead.status));
    return { active: active.length, overdue: active.filter(lead => lead.proxima_acao_em && new Date(lead.proxima_acao_em) < now).length,
      missingNextAction: active.filter(lead => !lead.proxima_acao).length, missingOwner: active.filter(lead => !lead.responsavel).length,
      stale: active.filter(lead => now - new Date(lead.last_moved_at || lead.updated_at || lead.created_at) > 7 * 86400000).length };
  }
  renderLeads = function () {
    mountLeadFields(); originalLeads();
    const board = byId('leads-board');
    if (!board?.parentNode || !document.createElement || empresasAcessiveisErro || !empresasAcessiveis) return;
    let summary = byId('ops-leads-summary');
    if (!summary) { summary = document.createElement('p'); summary.id = 'ops-leads-summary'; board.parentNode.insertBefore(summary, board); }
    summary.style.cssText = 'font-size:12px;color:#475569;';
    const state = leadWorkSummary();
    summary.textContent = 'Projeto selecionado: ' + state.active + ' lead(s) aberto(s) · ' + state.overdue + ' ação(ões) atrasada(s) · ' + state.missingNextAction + ' sem próxima ação · ' + state.missingOwner + ' sem responsável · ' + state.stale + ' sem movimentação há 7 dias. Histórico de etapas disponível a partir da ativação desta evolução.'
      + (leads.length >= 1000 ? ' Leitura limitada aos 1.000 leads mais recentes autorizados; os indicadores podem estar incompletos.' : ' Indicadores calculados sobre os leads autorizados carregados.');
    board.querySelectorAll('[data-lead-id]').forEach(card => {
      const lead = leads.find(item => String(item.id) === card.dataset.leadId);
      if (!lead) return;
      const detail = document.createElement('p'); detail.style.cssText = 'font-size:11px;color:#64748B;white-space:pre-wrap;';
      detail.textContent = 'Responsável: ' + (lead.responsavel || 'não definido') + '\nPróxima ação: ' + (lead.proxima_acao || 'não definida')
        + (lead.proxima_acao_em ? '\nPrazo: ' + new Date(lead.proxima_acao_em).toLocaleString('pt-BR') : '');
      card.appendChild(detail);
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Histórico de etapas';
      button.addEventListener('click', () => openLeadHistory(lead.id)); card.appendChild(button);
    });
  };
  async function openLeadHistory(id) {
    const epoch = painelEpoch, project = selLeadCompany;
    try {
      const result = await backend('lead_history', { lead_id: id });
      if (!current(epoch) || project !== selLeadCompany) return;
      const board = byId('leads-board'); if (!board?.parentNode || !document.createElement) return;
      let box = byId('ops-lead-history');
      if (!box) { box = document.createElement('div'); box.id = 'ops-lead-history'; board.parentNode.insertBefore(box, board); }
      box.style.cssText = 'padding:14px;border:1px solid #E2E8F0;border-radius:8px;margin-bottom:12px;white-space:pre-wrap;font-size:12px;';
      box.textContent = 'Histórico registrado de etapas\n' + ((result.events || []).map(item =>
        new Date(item.created_at).toLocaleString('pt-BR') + ' · ' + (item.from_status ? leadStatus(item.from_status).label + ' → ' : '') + leadStatus(item.to_status).label + (item.actor_id ? ' · Autor: ' + item.actor_id : '')).join('\n') || 'Sem eventos registrados. Estados anteriores à ativação não foram reconstruídos.');
      const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Fechar histórico'; close.addEventListener('click', () => box.remove()); box.appendChild(close);
    } catch (error) { if (current(epoch)) notifyError(error); }
  }

  const contactRequests = new Map();
  function normalizeProject(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function reviewContact(id) {
    const contact = contatos.find(item => String(item.id) === String(id));
    const list = byId('contatos-list');
    if (!contact || !list?.parentNode || !document.createElement) return;
    const linked = leads.find(item => String(item.contato_origem_id || '') === String(id));
    if (linked && empresasDeLead().some(company => company.id === linked.empresa_id)) {
      if (leadFormTemRascunho() && !confirm('Abrir o lead vinculado descarta o formulário de lead atual. Continuar?')) return;
      selLeadCompany = linked.empresa_id; showTab('leads'); renderLeads(); preencherFormLead(linked);
      toast('Este contato já está vinculado ao lead aberto.'); return;
    }
    const previous = byId('ops-contact-review'); if (previous) previous.remove();
    const form = document.createElement('form'); form.id = 'ops-contact-review';
    form.style.cssText = 'display:grid;gap:10px;padding:16px;margin-bottom:14px;background:#F8FAFC;border:1px solid #CBD5E1;border-radius:10px;';
    form.innerHTML = '<strong>Revisar contato antes de criar o lead</strong><label>Projeto <select id="ops-contact-project" required><option value="">Escolha o projeto de destino</option>'
      + empresasDeLead().map(company => '<option value="' + escapeHtml(company.id) + '">' + escapeHtml(company.name) + '</option>').join('') + '</select></label>'
      + '<label>Nome <input id="ops-contact-name" required maxlength="200"></label><label>E-mail <input id="ops-contact-email" type="email"></label>'
      + '<label>Telefone <input id="ops-contact-phone"></label><label>Observação <textarea id="ops-contact-notes" maxlength="4000"></textarea></label>'
      + '<div><button type="submit">Confirmar conversão</button> <button type="button" id="ops-contact-cancel">Cancelar</button></div><p id="ops-contact-feedback" role="status"></p>';
    list.parentNode.insertBefore(form, list);
    const matching = empresasDeLead().find(company => normalizeProject(company.id) === normalizeProject(contact.projeto) || normalizeProject(company.name) === normalizeProject(contact.projeto));
    byId('ops-contact-project').value = matching?.id || '';
    byId('ops-contact-name').value = contact.nome || ''; byId('ops-contact-email').value = contact.email || '';
    byId('ops-contact-phone').value = contact.whatsapp || ''; byId('ops-contact-notes').value = contact.mensagem || '';
    byId('ops-contact-cancel').addEventListener('click', () => form.remove());
    form.addEventListener('input', () => contactRequests.delete(String(id)));
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (writes.has(painelEpoch + ':contact:' + id)) return;
      const epoch = painelEpoch, lease = epoch + ':contact:' + id;
      const lead = { empresa_id: byId('ops-contact-project').value, nome: byId('ops-contact-name').value.trim(),
        email: byId('ops-contact-email').value.trim() || null, telefone: byId('ops-contact-phone').value.trim() || null,
        observacao: byId('ops-contact-notes').value.trim() || null, status: 'novo' };
      if (!empresasDeLead().some(company => company.id === lead.empresa_id) || !lead.nome || !byId('ops-contact-email').checkValidity()) {
        text('ops-contact-feedback', 'Revise o projeto, o nome e o e-mail antes de confirmar.'); return;
      }
      if (leadDuplicates(lead).length) { text('ops-contact-feedback', 'Já existe um lead com esse e-mail ou telefone no projeto. Revise-o antes de converter novamente.'); return; }
      const requestId = contactRequests.get(String(id)) || uuid(); contactRequests.set(String(id), requestId);
      writes.add(lease); text('ops-contact-feedback', 'Confirmando conversão no servidor...');
      try {
        const result = await backend('convert_contact', { contato_id: id, empresa_id: lead.empresa_id, request_id: requestId, lead });
        if (!current(epoch)) return;
        const saved = result.lead; if (!saved?.id) throw new Error('O servidor não confirmou o lead.');
        if (!leads.some(item => String(item.id) === String(saved.id))) leads.unshift(lembrarLead(saved));
        contactRequests.delete(String(id)); form.remove(); renderLeads(); toast(result.existing ? 'Contato já vinculado a um lead existente.' : 'Contato convertido em lead.');
      } catch (error) { if (current(epoch)) text('ops-contact-feedback', error.message); }
      finally { writes.delete(lease); }
    });
    form.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); byId('ops-contact-project')?.focus();
  }
  const originalContacts = renderContatos;
  renderContatos = function () {
    originalContacts();
    const list = byId('contatos-list');
    if (!list || !document.createElement) return;
    list.querySelectorAll('button[onclick^="excluirContato("]').forEach(button => {
      const match = (button.getAttribute('onclick') || '').match(/decodeURIComponent\('([^']+)'\)/);
      if (!match) return;
      const id = decodeURIComponent(match[1]);
      const convert = document.createElement('button'); convert.type = 'button';
      convert.textContent = leads.some(item => String(item.contato_origem_id || '') === id) ? 'Lead vinculado — revisar' : 'Criar lead — revisar';
      convert.style.cssText = 'background:#EEF2FF;color:#1E6FFF;border:0;padding:5px 10px;border-radius:6px;font-size:11px;';
      convert.addEventListener('click', () => reviewContact(id)); button.parentNode.insertBefore(convert, button);
    });
  };

  let reimbursements = [], reimbursementsEpoch = -1, reimbursementsLoading = false, reimbursementsError = '';
  const reimbursementRequests = new Map();
  function personalExpenses(socio) {
    let total = 0;
    for (const month of MONTHS) for (const company of COMPANIES) {
      const entry = getLanc(month, company.id);
      if (entry.pagador === socio && entry.meio_pagamento && entry.meio_pagamento !== 'cartao_empresa') total += calcCustos(entry);
      for (const cost of getCustosExtras(month, company.id)) if (cost.pagador === socio && cost.meio_pagamento && cost.meio_pagamento !== 'cartao_empresa') total += Number(cost.valor || 0);
    }
    return Math.round(total * 100) / 100;
  }
  function reimbursementTotals(socio) {
    const paid = reimbursements.filter(item => item.socio === socio && item.status === 'confirmed').reduce((total, item) => total + Number(item.valor || 0), 0);
    const expenses = personalExpenses(socio);
    return { expenses, reimbursed: Math.round(paid * 100) / 100, pending: Math.round((expenses - paid) * 100) / 100 };
  }
  async function loadReimbursements(force = false) {
    if (!paginaLiberada('balanco') || !empresasAcessiveis?.has('arcade_hub') || reimbursementsLoading || (!force && reimbursementsEpoch === painelEpoch)) return;
    const epoch = painelEpoch;
    reimbursementsLoading = true; reimbursementsError = '';
    try {
      const result = await backend('list_reimbursements', { ano: EXERCICIO });
      if (!current(epoch)) return;
      reimbursements = Array.isArray(result.reimbursements) ? result.reimbursements : []; reimbursementsEpoch = epoch;
    } catch (error) { if (current(epoch)) { reimbursementsError = error.message; reimbursementsEpoch = epoch; } }
    finally { if (current(epoch)) { reimbursementsLoading = false; renderBalancoSocios(); } }
  }
  const originalBalance = renderBalancoSocios;
  renderBalancoSocios = function () {
    if (!paginaLiberada('balanco')) return;
    originalBalance();
    if (!empresasAcessiveis?.has('arcade_hub')) return;
    if (reimbursementsEpoch !== painelEpoch && !reimbursementsLoading) loadReimbursements();
    const table = byId('balanco-socios-table');
    if (table && reimbursementsEpoch === painelEpoch && !reimbursementsError) {
      const states = SOCIOS.map(socio => ({ socio, aporte: getAporteSocioTotal(socio), share: getParticipacaoSocio(socio), ...reimbursementTotals(socio) }));
      const header = table.closest?.('table')?.querySelector('thead tr');
      if (header) header.innerHTML = '<th>Sócio</th><th>Participação</th><th>Aportes</th><th>Pago pessoalmente</th><th>Reembolsos registrados</th><th>Saldo pendente</th>';
      table.innerHTML = states.map(state => '<tr><td>' + escapeHtml(state.socio) + '</td><td><input class="inp" type="number" min="0" max="100" step="0.1" value="' + Number(state.share) + '" aria-label="Participação de ' + escapeHtml(state.socio) + '" style="width:75px;" oninput="setParticipacaoSocio(\'' + state.socio + '\',this.value)"> %</td><td>' + fmt(state.aporte) + '</td><td>' + fmt(state.expenses) + '</td><td>' + fmt(state.reimbursed) + '</td><td>' + fmt(state.pending) + '</td></tr>').join('');
      const total = key => states.reduce((sum, state) => sum + state[key], 0);
      const kpis = byId('balanco-kpis');
      if (kpis) kpis.innerHTML = kpiCard('Aportes societários', fmt(total('aporte')), 'separados de reembolso', '#8B5CF6')
        + kpiCard('Pago pessoalmente', fmt(total('expenses')), 'despesas registradas no exercício', '#EF4444')
        + kpiCard('Reembolsos registrados', fmt(total('reimbursed')), 'pagamentos já realizados e confirmados', '#059669')
        + kpiCard('Saldo pendente', fmt(total('pending')), 'pessoal menos baixas confirmadas', '#F59E0B');
    }
    mountReimbursementPanel();
  };
  function mountReimbursementPanel() {
    const container = byId('tab-balanco');
    if (!container || !document.createElement) return;
    let panel = byId('ops-reimbursement-panel');
    if (!panel) {
      panel = document.createElement('section'); panel.id = 'ops-reimbursement-panel';
      panel.style.cssText = 'background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:16px;margin-top:20px;';
      panel.innerHTML = '<h3 style="font-size:15px;">Registrar reembolso já realizado</h3><p style="font-size:12px;color:#64748B;">Este registro baixa uma despesa pessoal; não faz transferência, não cria aporte e não desconta novamente o Caixa Atual. Baixas antigas não foram presumidas.</p>'
        + '<form id="ops-reimbursement-form" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">'
        + '<label>Sócio <select id="ops-reimbursement-owner">' + SOCIOS.map(owner => '<option value="' + escapeHtml(owner) + '">' + escapeHtml(owner) + '</option>').join('') + '</select></label>'
        + '<label>Valor (R$) <input id="ops-reimbursement-value" inputmode="decimal" required></label><label>Data do pagamento <input id="ops-reimbursement-date" type="date" required></label>'
        + '<label>Referência/comprovante <input id="ops-reimbursement-ref" maxlength="200" required></label><label>Observação <input id="ops-reimbursement-notes" maxlength="1000"></label>'
        + '<button type="submit">Registrar baixa</button></form><p id="ops-reimbursement-feedback" role="status" style="font-size:12px;"></p><div id="ops-reimbursement-list"></div>';
      container.appendChild(panel);
      byId('ops-reimbursement-date').value = calTodayISO();
      byId('ops-reimbursement-form').addEventListener('input', () => reimbursementRequests.delete('new'));
      byId('ops-reimbursement-form').addEventListener('submit', recordReimbursement);
    }
    const feedback = reimbursementsError || (reimbursementsLoading ? 'Conferindo baixas registradas...' : 'Saldo pendente calculado somente com registros confirmados.');
    if (!writes.has(painelEpoch + ':reimbursement')) text('ops-reimbursement-feedback', feedback);
    const list = byId('ops-reimbursement-list'); if (!list) return;
    list.replaceChildren();
    if (reimbursementsError) {
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Tentar carregar reembolsos novamente';
      retry.addEventListener('click', () => loadReimbursements(true)); list.appendChild(retry); return;
    }
    for (const item of reimbursements) {
      const row = document.createElement('div'); row.style.cssText = 'padding:10px 0;border-bottom:1px solid #F1F5F9;font-size:12px;';
      row.textContent = item.socio + ' · ' + fmt(item.valor) + ' · ' + item.data_pagamento + ' · ' + item.referencia + ' · ' + (item.status === 'cancelled' ? 'Cancelado: ' + (item.cancel_reason || '') : 'Confirmado');
      if (item.status === 'confirmed') {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Cancelar baixa';
        button.addEventListener('click', () => cancelReimbursement(item.id)); row.appendChild(button);
      }
      list.appendChild(row);
    }
  }
  async function recordReimbursement(event) {
    event.preventDefault();
    const epoch = painelEpoch, lease = epoch + ':reimbursement';
    if (writes.has(lease)) return;
    const payment = { socio: byId('ops-reimbursement-owner').value, valor: parseValorBR(byId('ops-reimbursement-value').value),
      data_pagamento: byId('ops-reimbursement-date').value, referencia: byId('ops-reimbursement-ref').value.trim(),
      observacao: byId('ops-reimbursement-notes').value.trim() || null };
    if (!SOCIOS.includes(payment.socio) || !Number.isFinite(payment.valor) || payment.valor <= 0 || !payment.referencia || !payment.data_pagamento || payment.data_pagamento > calTodayISO()) {
      text('ops-reimbursement-feedback', 'Confira sócio, valor, referência e data de um pagamento já realizado.'); return;
    }
    if (reimbursementsEpoch !== epoch || reimbursementsError) { text('ops-reimbursement-feedback', 'Carregue as baixas confirmadas antes de registrar outra.'); return; }
    if (Math.round(payment.valor * 100) > Math.round(reimbursementTotals(payment.socio).pending * 100)) { text('ops-reimbursement-feedback', 'O valor é maior que o saldo pendente deste sócio. Revise os registros.'); return; }
    if (!confirm('Registrar reembolso já realizado de ' + fmt(payment.valor) + ' para ' + payment.socio + '?')) return;
    const requestId = reimbursementRequests.get('new') || uuid(); reimbursementRequests.set('new', requestId);
    writes.add(lease); text('ops-reimbursement-feedback', 'Confirmando baixa no servidor...');
    try {
      await backend('record_reimbursement', { request_id: requestId, payment });
      if (!current(epoch)) return;
      reimbursementRequests.delete('new'); byId('ops-reimbursement-form')?.reset();
      if (byId('ops-reimbursement-date')) byId('ops-reimbursement-date').value = calTodayISO();
      await loadReimbursements(true); if (current(epoch)) toast('Reembolso registrado.');
    } catch (error) { if (current(epoch)) text('ops-reimbursement-feedback', error.message); }
    finally { writes.delete(lease); }
  }
  async function cancelReimbursement(id) {
    const reason = prompt('Motivo do cancelamento desta baixa (o registro permanecerá no histórico):');
    if (!reason?.trim()) return;
    const epoch = painelEpoch;
    try { await backend('cancel_reimbursement', { id, reason: reason.trim() }); if (current(epoch)) await loadReimbursements(true); }
    catch (error) { if (current(epoch)) notifyError(error); }
  }

  const originalLoad = loadAll;
  loadAll = async function (epoch) {
    const failures = await originalLoad(epoch);
    if (!current(epoch)) return failures;
    if (!(failures || []).includes('estrutura')) confirmStructureAportes(estrutura);
    let result;
    try { result = await comTempoLimite(sb.from('leads').select(leadFields).order('created_at', { ascending: false }).limit(1000), 12000); }
    catch (_) { result = null; }
    if (!current(epoch)) return failures;
    const complete = Array.isArray(result?.data) && !result.error;
    const combined = [...new Set([...(failures || []), ...(!complete ? ['acompanhamento dos leads'] : [])])];
    if (complete) leads = result.data.map(lembrarLead);
    window.DashboardFinance?.setLoadFailures?.(combined);
    return combined;
  };
  const originalReset = resetState;
  resetState = async function () {
    for (const state of manualSaves.values()) clearTimeout(state.timer); manualSaves.clear();
    for (const state of structureSaves.values()) clearTimeout(state.timer); structureSaves.clear();
    writes.clear(); issues.clear(); leadRequestIds.clear(); leadIntentVersions.clear(); contactRequests.clear(); reimbursementRequests.clear();
    reimbursements = []; reimbursementsEpoch = -1; reimbursementsLoading = false; reimbursementsError = '';
    calendarProjectFilter = 'all';
    calendarBaseline = '';
    emailListState.query = ''; emailListState.page = 0; emailListState.pendingOnly = false; emailListState.scope = '';
    for (const id of ['ops-contact-review', 'ops-lead-history', 'ops-leads-summary', 'ops-reimbursement-panel', 'ops-email-tools']) byId(id)?.remove?.();
    const result = await originalReset();
    confirmStructureAportes(estrutura);
    return result;
  };

  window.DashboardOperations = { preserveDrafts, resumoCalendario, writes, drafts, limparDraftsDaSessao, saveEmailDraft, recoverEmailDraft, readEmailDraft, emailSearchRows,
    leadDuplicates, leadWorkSummary, reviewContact, openLeadHistory, personalExpenses, reimbursementTotals, loadReimbursements, recordReimbursement, cancelReimbursement, backend, flushStructure,
    flushManualSaves: () => Promise.all([...manualSaves.values()].map(flushManual)), confirmStructureAportes,
    getIssues: () => [...issues.values()].filter(issue => paginaLiberada(issue.page)) };
  window.preservarRascunhosDashboard = preserveDrafts;
})();
