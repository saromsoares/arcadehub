/* Stories 1.7/1.9. Classic script after the inline dashboard: no build required. */
(function () {
  'use strict';
  const pending = new Set();
  const metadataColumns = 'id,empresa_id,empresa_nome,rotulo,url,usuario,obs,ordem,created_at,updated_at,reviewed_at,review_due_at,credential_updated_at';
  const current = epoch => epoch === painelEpoch;
  const uuid = () => crypto.randomUUID();
  async function invoke(name, body) {
    const result = await sb.functions.invoke(name, { body });
    let message = result.data && result.data.error;
    if (result.error && !message && result.error.context && typeof result.error.context.json === 'function') {
      try { message = (await result.error.context.json()).error; } catch (_) { /* fixed fallback */ }
    }
    if (result.error || message || (result.data && result.data.ok === false)) throw new Error(message || 'Não foi possível confirmar a operação.');
    return result.data || {};
  }
  function failure(error) { toast(error && error.message || 'Não foi possível confirmar a operação.', 'erro'); }
  function refresh() {
    if (typeof preservarRascunhosDashboard === 'function') preservarRascunhosDashboard(() => renderAll());
    else renderAll();
  }
  const oldReset = resetState;
  const oldLogout = doLogout;
  const oldShowDashboard = showDashboard;
  const oldOpenAccessForm = abrirFormAcesso;
  abrirFormAcesso = function () {
    const form = document.getElementById('acesso-form');
    if (form) delete form.dataset.requestId;
    return oldOpenAccessForm();
  };
  let explicitLogout = false;
  let principalId = null;
  let principalReloadPending = false;
  function clearSessionDrafts() {
    if (globalThis.DashboardOperations && typeof globalThis.DashboardOperations.limparDraftsDaSessao === 'function') globalThis.DashboardOperations.limparDraftsDaSessao();
    else if (typeof globalThis.limparDraftsDaSessao === 'function') globalThis.limparDraftsDaSessao();
  }
  doLogout = async function () {
    clearSessionDrafts();
    explicitLogout = true;
    try { return await oldLogout(); }
    finally { explicitLogout = false; }
  };
  function hidePrivateScreen() {
    for (const id of ['main', 'sidebar', 'loading-overlay']) { const node = document.getElementById(id); if (node) node.style.display = 'none'; }
    const login = document.getElementById('login-screen'); if (login) login.style.display = 'flex';
  }
  function principalChanged(nextId) {
    if (principalReloadPending) return;
    principalReloadPending = true; principalId = nextId;
    painelEpoch++; painelEpochCarregado = -1; clearSessionDrafts();
    senhasReveladas.clear(); acessosVisiveis.clear(); mestraDigitada = null; acessosMestraOk = false;
    hidePrivateScreen();
    // The auth callback must not await another auth operation while its lock is held.
    Promise.resolve().then(() => resetState()).catch(() => { /* screen remains hidden */ }).finally(() => {
      if (window.location && typeof window.location.reload === 'function') window.location.reload();
    });
  }
  showDashboard = function (user) {
    const nextId = user && user.id ? String(user.id) : null;
    if (principalReloadPending) return Promise.resolve();
    if (principalId && nextId && principalId !== nextId) { principalChanged(nextId); return Promise.resolve(); }
    principalId = nextId;
    return oldShowDashboard(user);
  };
  resetState = async function () {
    // Invalidate synchronous flags immediately, before removeAllChannels can await.
    mpSaldoLoading = false; stripeSaldoLoading = false; nuSaldoLoading = false;
    mpRealtimeOn = false; stripeRealtimeOn = false;
    for (const timer of [mpPollTimer, stripePollTimer, nuPollTimer]) if (timer) clearInterval(timer);
    mpPollTimer = stripePollTimer = nuPollTimer = null;
    senhasReveladas.clear(); acessosVisiveis.clear(); acessosMestraOk = false; mestraDigitada = null;
    pending.clear();
    await oldReset();
    mpSaldoLoading = false; stripeSaldoLoading = false; nuSaldoLoading = false;
    mpRealtimeOn = false; stripeRealtimeOn = false;
    currentEmpresaId = null;
  };
  sb.auth.onAuthStateChange((event, session) => {
    const nextId = session && session.user && session.user.id ? String(session.user.id) : null;
    if (event === 'SIGNED_OUT') {
      principalId = null;
      if (explicitLogout) return;
      painelEpoch++; painelEpochCarregado = -1; clearSessionDrafts(); hidePrivateScreen();
      Promise.resolve().then(() => resetState()).catch(() => { /* local caches were already invalidated */ });
    } else if (nextId) {
      if (principalId && nextId !== principalId) principalChanged(nextId);
      else principalId = nextId;
    }
  });

  verificarMestra = async function () {
    if (acessosMestraOk && mestraDigitada) return true;
    const epoch = painelEpoch;
    const value = prompt('Senha mestra para esta operação:');
    if (!value) return false;
    try {
      await invoke('acessos-manage', { action: 'verify', mestra: value });
      if (!current(epoch)) return false;
      mestraDigitada = value; acessosMestraOk = true; return true;
    } catch (error) {
      if (current(epoch)) { mestraDigitada = null; acessosMestraOk = false; failure(error); }
      return false;
    }
  };
  buscarSenhaAcesso = async function (id, action) {
    const epoch = painelEpoch, key = String(id);
    try {
      // Always authorize in the server, including a repeated Copy, for its audit event.
      const result = await invoke('acesso-senha', { id: key, mestra: mestraDigitada || '', action: action === 'copiar' ? 'copiar' : 'revelar' });
      if (!current(epoch)) return null;
      const value = typeof result.senha === 'string' ? result.senha : '';
      senhasReveladas.set(key, value);
      return value;
    } catch (error) {
      if (current(epoch)) { acessosMestraOk = false; mestraDigitada = null; failure(error); }
      return null;
    }
  };
  toggleSenhaAcesso = async function (id) {
    const epoch = painelEpoch, key = String(id);
    if (acessosVisiveis.has(key)) { acessosVisiveis.delete(key); senhasReveladas.delete(key); renderAcessos(); return; }
    if (!await verificarMestra() || !current(epoch)) return;
    const password = await buscarSenhaAcesso(key, 'revelar');
    if (password === null || !current(epoch)) return;
    acessosVisiveis.add(key); renderAcessos();
  };
  copiarSenhaAcesso = async function (id, button) {
    const epoch = painelEpoch;
    if (!await verificarMestra() || !current(epoch)) return;
    const password = await buscarSenhaAcesso(id, 'copiar');
    if (password === null || !current(epoch)) return;
    try {
      if (!current(epoch)) return;
      await navigator.clipboard.writeText(password);
      if (current(epoch) && button) { button.textContent = 'Copiado'; setTimeout(() => { if (current(epoch) && button.isConnected) button.textContent = 'Copiar senha'; }, 1200); }
    } catch (_) { if (current(epoch)) toast('Não foi possível copiar. Revele a senha e copie manualmente.', 'erro'); }
  };

  renderAcessos = function () {
    const list = document.getElementById('acessos-list');
    if (!list) return;
    const datalist = document.getElementById('acesso-empresas-list');
    if (datalist) datalist.innerHTML = FILHAS.map(c => `<option value="${escapeHtml(c.name)}"></option>`).join('');
    const passwordField = document.getElementById('acesso-senha');
    if (passwordField) passwordField.type = 'password';
    if (!acessosEmpresas.length) { list.innerHTML = '<p class="empty-state">Nenhum acesso cadastrado.</p>'; return; }
    const button = (action, id, label) => `<button type="button" data-access-action="${action}" data-access-id="${escapeHtml(String(id))}" style="border:1px solid #D1D5DB;border-radius:6px;background:#F9FAFB;padding:5px 9px;cursor:pointer;">${label}</button>`;
    list.innerHTML = acessosEmpresas.map(access => {
      const key = String(access.id), visible = acessosVisiveis.has(key), value = senhasReveladas.get(key);
      const due = access.review_due_at && Date.parse(access.review_due_at) < Date.now();
      const reviewed = access.reviewed_at ? new Date(access.reviewed_at).toLocaleDateString('pt-BR') : 'ainda não revisado';
      return `<article style="background:white;border:1px solid #E5E7EB;border-radius:12px;padding:15px;margin:10px 0;overflow-wrap:anywhere;">
        <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;"><strong>${escapeHtml(access.empresa_nome || access.empresa_id || 'Acesso')} · ${escapeHtml(access.rotulo || 'Painel admin')}</strong><span>${button('edit', key, 'Editar')} ${button('delete', key, 'Excluir')}</span></div>
        ${access.url ? `<p><a href="${safeUrl(access.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(access.url)}</a></p>` : ''}
        <dl style="display:grid;grid-template-columns:80px 1fr;gap:8px;"><dt>Usuário</dt><dd style="margin:0;">${escapeHtml(access.usuario || '—')} ${button('copy-user', key, 'Copiar usuário')}</dd><dt>Senha</dt><dd style="margin:0;font-family:monospace;">${visible && value != null ? escapeHtml(value) : '••••••••'} ${button('reveal', key, visible ? 'Ocultar' : 'Mostrar')} ${button('copy-password', key, 'Copiar senha')}</dd></dl>
        ${access.obs ? `<p>${escapeHtml(access.obs)}</p>` : ''}
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:${due ? '#B91C1C' : '#6B7280'};">Revisão: ${escapeHtml(reviewed)}${due ? ' · revisão pendente' : ''} ${button('review', key, 'Registrar revisão')} ${button('events', key, 'Histórico de uso')}</div>
      </article>`;
    }).join('');
  };

  salvarAcesso = async function () {
    const epoch = painelEpoch, form = document.getElementById('acesso-form'), feedback = document.getElementById('acesso-feedback');
    if (pending.has('access-save')) return;
    const get = field => document.getElementById('acesso-' + field).value;
    const id = get('id'), name = get('empresa').trim();
    if (!name) { feedback.textContent = 'Informe a empresa.'; return; }
    const known = COMPANIES.find(c => c.name.toLowerCase() === name.toLowerCase());
    const empresaId = known ? known.id : name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const password = get('senha');
    const access = { empresa_id: empresaId, empresa_nome: name, rotulo: get('rotulo').trim() || 'Painel admin', url: get('url').trim() || null, usuario: get('usuario').trim() || null, obs: get('obs').trim() || null };
    if (password) {
      if (!await verificarMestra() || !current(epoch)) return;
      access.senha = password;
    }
    if (!form.dataset.requestId) form.dataset.requestId = uuid();
    pending.add('access-save'); feedback.textContent = 'Salvando...';
    try {
      const result = await invoke('acessos-manage', { action: 'save', id: id || undefined, request_id: form.dataset.requestId, access, mestra: password ? mestraDigitada : undefined });
      if (!current(epoch)) return;
      if (!result.access || !result.access.id) throw new Error('O servidor não confirmou o acesso.');
      const index = acessosEmpresas.findIndex(row => String(row.id) === String(result.access.id));
      if (index >= 0) acessosEmpresas[index] = result.access; else acessosEmpresas.push(result.access);
      senhasReveladas.delete(String(result.access.id)); acessosVisiveis.delete(String(result.access.id));
      document.getElementById('acesso-senha').value = ''; delete form.dataset.requestId;
      fecharFormAcesso(); renderAcessos(); toast('Acesso salvo.');
    } catch (error) { if (current(epoch)) { feedback.textContent = error.message || 'Falha ao salvar.'; feedback.style.color = '#B91C1C'; failure(error); } }
    finally { if (current(epoch)) pending.delete('access-save'); }
  };
  excluirAcesso = async function (id) {
    if (!confirm('Excluir este acesso e sua credencial?')) return;
    const epoch = painelEpoch;
    if (!await verificarMestra() || !current(epoch)) return;
    try {
      const result = await invoke('acessos-manage', { action: 'delete', id: String(id), mestra: mestraDigitada });
      if (!current(epoch)) return;
      if (!result.deleted) throw new Error('O servidor não confirmou a exclusão.');
      acessosEmpresas = acessosEmpresas.filter(row => String(row.id) !== String(id));
      senhasReveladas.delete(String(id)); acessosVisiveis.delete(String(id)); renderAcessos();
    } catch (error) { if (current(epoch)) failure(error); }
  };
  async function accessReview(id) {
    const epoch = painelEpoch;
    const due = prompt('Próxima revisão (AAAA-MM-DD), ou deixe vazio:', '');
    if (due === null) return;
    if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(due + 'T12:00:00Z')))) { toast('Data de revisão inválida.', 'erro'); return; }
    const result = await invoke('acessos-manage', { action: 'review', id: String(id), review_due_at: due ? due + 'T12:00:00Z' : null });
    if (!current(epoch)) return;
    acessosEmpresas = acessosEmpresas.map(row => String(row.id) === String(id) ? result.access : row); renderAcessos();
  }
  async function accessEvents(id) {
    const epoch = painelEpoch;
    const result = await invoke('acessos-manage', { action: 'events', id: String(id) });
    if (!current(epoch)) return;
    const events = result.events || [];
    alert(events.length ? events.map(event => new Date(event.created_at).toLocaleString('pt-BR') + ' · ' + event.action + ' · usuário ' + event.actor_id).join('\n') : 'Nenhum uso registrado desde a implantação da auditoria.');
  }
  document.addEventListener('click', async event => {
    const button = event.target && event.target.closest && event.target.closest('[data-access-action]');
    if (!button) return;
    const id = button.dataset.accessId, action = button.dataset.accessAction;
    const epoch = painelEpoch;
    try {
      if (action === 'edit') editarAcesso(id);
      else if (action === 'delete') await excluirAcesso(id);
      else if (action === 'reveal') await toggleSenhaAcesso(id);
      else if (action === 'copy-password') await copiarSenhaAcesso(id, button);
      else if (action === 'copy-user') { const access = acessosEmpresas.find(row => String(row.id) === String(id)); if (access && current(epoch)) await copiarAcesso(String(access.usuario || ''), button); }
      else if (action === 'review') await accessReview(id);
      else if (action === 'events') await accessEvents(id);
    } catch (error) { if (current(epoch)) failure(error); }
  });

  async function assign(provider, id, company) {
    const page = provider === 'stripe' ? 'stripe' : 'mercadopago';
    if (!paginaLiberada(page)) return;
    const key = provider + ':' + id, epoch = painelEpoch;
    if (pending.has(key)) return;
    const list = provider === 'stripe' ? stripeRecebimentos : mpRecebimentos;
    const original = list.find(row => String(row.id) === String(id));
    if (!original) return;
    if (company && !COMPANIES.some(c => c.id === company) && !SOCIOS.some(s => company === 'aporte:' + s)) { toast('Destino inválido.', 'erro'); return; }
    pending.add(key);
    try {
      const response = await sb.from(provider === 'stripe' ? 'stripe_recebimentos' : 'mp_recebimentos').update({ empresa_id: company || null }).eq('id', id).select('id,empresa_id').maybeSingle();
      if (!current(epoch)) return;
      if (response.error || !response.data) throw new Error('Não foi possível confirmar o vínculo. O destino anterior foi mantido.');
      const actual = (provider === 'stripe' ? stripeRecebimentos : mpRecebimentos).find(row => String(row.id) === String(id));
      if (actual) actual.empresa_id = response.data.empresa_id;
      refresh(); toast('Recebimento vinculado.');
    } catch (error) { if (current(epoch)) { failure(error); if (provider === 'stripe') renderStripe(); else renderMercadoPago(); } }
    finally { if (current(epoch)) pending.delete(key); }
  }
  atribuirEmpresaStripe = (id, company) => assign('stripe', id, company);
  atribuirEmpresaMP = (id, company) => assign('mp', id, company);

  globalThis.DashboardSecurity = { invoke, metadataColumns, pending };
})();
