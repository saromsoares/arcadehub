import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
export function dashboardHarness({ modules = ['dashboard-finance.js'], query, invoke, now = '2026-11-14T15:00:00Z' } = {}) {
  const elements = new Map(), callbacks = new Map(), events = new Map(), calls = [], timers = new Map();
  let nextTimer = 1;
  function element(id = '') {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set();
    const el = { id, innerHTML: '', textContent: '', value: '', type: 'text', checked: false, disabled: false,
      hidden: false, style: {}, dataset: {}, children: [], options: [],
      classList: { contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c), toggle(c, force) { if (force ?? !classes.has(c)) classes.add(c); else classes.delete(c); } },
      addEventListener(type, fn) { events.set(id + ':' + type, fn); }, querySelectorAll: () => [], querySelector: () => null,
      closest: () => null, focus() {}, scrollIntoView() {}, remove() { elements.delete(id); }, reset() {}, replaceChildren(...children) { this.children = children; this.innerHTML = ''; },
      removeAttribute(name) { delete this[name]; },
      getAttribute(name) { return this[name] || ''; }, setAttribute(name, value) { this[name] = value; },
      appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
      insertAdjacentHTML(_position, value) { this.innerHTML += value; } };
    elements.set(id, el); return el;
  }
  function builder(table) {
    const call = { table, method: 'GET', filters: [], payload: undefined, columns: null };
    const chain = {
      select(columns) { call.columns = columns; return chain; },
      eq(key, value) { call.filters.push([key, value]); return chain; },
      in(key, value) { call.filters.push([key, value]); return chain; },
      order() { return chain; }, limit(value) { call.limit = value; return chain; }, range(a, b) { call.range = [a, b]; return chain; },
      maybeSingle() { call.single = true; return chain; }, single() { call.single = true; return chain; },
      insert(value) { call.method = 'INSERT'; call.payload = value; return chain; },
      update(value) { call.method = 'UPDATE'; call.payload = value; return chain; },
      upsert(value) { call.method = 'UPSERT'; call.payload = value; return chain; }, delete() { call.method = 'DELETE'; return chain; },
      then(resolve, reject) { calls.push(call); return Promise.resolve(query ? query(call) : { data: call.single ? null : [], error: null }).then(resolve, reject); },
    }; return chain;
  }
  const sdk = { auth: { onAuthStateChange(fn) { callbacks.set('auth', fn); }, getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) },
    functions: { invoke: async (name, args) => { calls.push({ function: name, args }); return invoke ? invoke(name, args) : { data: null, error: { message: 'fixture unavailable' } }; } },
    from: builder, removeAllChannels: async () => { callbacks.delete('stripe-recebimentos-rt-v3'); callbacks.delete('mp-recebimentos-rt-v3'); },
    channel(name) { return { on(_type, filter, fn) { callbacks.set(name, fn); callbacks.set(filter.table, fn); return this; }, subscribe() { return this; } }; },
  };
  const store = new Map();
  const storage = { get length() { return store.size; }, key: index => [...store.keys()][index] || null, getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Date.parse(now); } }
  const context = vm.createContext({ console, URL, Date: Clock, Intl, Set, Map, Promise, TextEncoder, AbortController,
    crypto: globalThis.crypto, structuredClone, location: { hash: '', search: '', pathname: '/admin/' }, sessionStorage: storage,
    supabase: { createClient: () => sdk }, Chart: class { constructor(_element, config) { this.data = config.data; } destroy() {} update() {} },
    document: { addEventListener(type, fn) { events.set('document:' + type, fn); }, getElementById: element,
      createElement: tag => element('created-' + tag + '-' + elements.size), querySelectorAll: () => [], querySelector: () => null, activeElement: null },
    navigator: { clipboard: { writeText: async () => {} } }, confirm: () => true, prompt: () => null, alert() {},
    setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    setInterval(fn) { const id = nextTimer++; timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id) });
  context.window = context;
  const html = readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');
  const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  new vm.Script(inline, { filename: 'admin-inline.js' }).runInContext(context);
  for (const name of modules) {
    const path = new URL('../admin/' + name, import.meta.url);
    if (!existsSync(path)) throw new Error('Module absent: ' + name);
    new vm.Script(readFileSync(path, 'utf8'), { filename: name }).runInContext(context);
  }
  return { context, run: code => vm.runInContext(code, context), element, elements, callbacks, events, calls, timers, sdk, store };
}
