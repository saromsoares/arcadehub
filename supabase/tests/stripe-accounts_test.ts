// Local HTTP fixtures only. No --allow-net: accidental external requests fail.
import assert from "node:assert/strict";
import {
  stripeAccounts,
  stripeBalance,
} from "../functions/_shared/stripe-accounts.ts";

Deno.env.set("SUPABASE_URL", "https://qa.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "qa-service-key");
const holdingId = "acct_1Te0GtHMBfCrtXpm",
  clickdropId = "acct_ClickDropFixture";
type Row = Record<string, any>;
type Call = {
  path: string;
  method: string;
  authorization: string;
  url: URL;
  payload?: Row[] | Row;
  prefer?: string;
};
let calls: Call[] = [], rows = new Map<string, Row>();
let charges: Record<string, Row[]> = {},
  balances: Record<string, Row> = {},
  movements: Record<string, Row> = {},
  owners: Record<string, string> = {};
let fail = new Set<string>(),
  throws = new Set<string>(),
  holdingAccess = true,
  databaseFails = false;
let history = new Map<string, Row>(),
  stripeBlocked = false,
  checkpointFails = false;
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const charge = (id: string, amount: number): Row => ({
  id,
  amount,
  currency: "brl",
  amount_refunded: 0,
  status: "succeeded",
  livemode: true,
  created: 1794656880,
  description: "Fixture payment",
  balance_transaction: { fee: 438, net: amount - 438 },
});

globalThis.fetch = async (
  input: string | URL | Request,
  init?: RequestInit,
) => {
  const request = new Request(input, init), url = new URL(request.url);
  const authorization = request.headers.get("authorization") || "";
  const payload = request.method === "POST" && url.hostname === "qa.invalid"
    ? await request.json()
    : undefined;
  calls.push({
    path: url.pathname,
    method: request.method,
    authorization,
    url,
    payload,
    prefer: request.headers.get("prefer") || "",
  });
  if (url.hostname === "api.stripe.com") {
    assert.equal(
      request.method,
      "GET",
      "The dashboard must never write to Stripe",
    );
    const owner = owners[authorization];
    if (throws.has(authorization)) {
      throw new Error("provider exception containing " + authorization);
    }
    if (!owner || fail.has(owner + url.pathname)) {
      return reply({ error: { message: "fixture failure" } }, 403);
    }
    if (url.pathname === "/v1/account") return reply({ id: owner });
    if (url.pathname === "/v1/balance") return reply(balances[owner]);
    if (url.pathname === "/v1/balance_transactions") {
      assert.equal(url.searchParams.get("limit"), "100");
      return reply(movements[owner] || { data: [], has_more: false });
    }
    if (url.pathname === "/v1/charges") {
      assert.equal(
        url.searchParams.get("expand[]"),
        "data.balance_transaction",
      );
      const all = charges[owner],
        after = url.searchParams.get("starting_after");
      const offset = after ? all.findIndex((row) => row.id === after) + 1 : 0;
      const page = all.slice(
        offset,
        offset + Number(url.searchParams.get("limit")),
      );
      return reply({ data: page, has_more: offset + page.length < all.length });
    }
  }
  assert.equal(url.hostname, "qa.invalid", "Unexpected network target");
  if (url.pathname === "/auth/v1/user") {
    return authorization === "Bearer user-token"
      ? reply({
        id: "00000000-0000-4000-8000-000000000001",
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: {},
      })
      : reply({ message: "Invalid token" }, 401);
  }
  if (url.pathname === "/rest/v1/usuarios_empresas") {
    return reply(holdingAccess ? [{ empresa_id: "arcade_hub" }] : []);
  }
  if (url.pathname === "/rest/v1/usuarios_paginas_bloqueadas") {
    return reply(stripeBlocked ? { paginas: ["stripe"] } : null);
  }
  if (url.pathname === "/rest/v1/stripe_sync_state") {
    return reply([...history.values()]);
  }
  if (url.pathname === "/rest/v1/rpc/stripe_history_claim") {
    const p = payload as Row, old = history.get(p.p_account_key);
    if (!p.p_start && (!old || old.complete)) return reply(null);
    const state = old && !old.complete ? old : {
      account_key: p.p_account_key,
      account_id: p.p_account_id,
      cursor_full: null,
      reviewed_count: 0,
    };
    state.lease_token = "00000000-0000-4000-8000-000000000002";
    state.complete = false;
    history.set(p.p_account_key, state);
    return reply(state);
  }
  if (url.pathname === "/rest/v1/rpc/stripe_history_checkpoint") {
    const p = payload as Row, state = history.get(p.p_account_key)!;
    if (checkpointFails) {
      return reply({ message: "fixture checkpoint failure" }, 500);
    }
    if (!p.p_error) {
      state.cursor_full = p.p_cursor;
      state.complete = p.p_completed;
      state.reviewed_count += p.p_reviewed;
    }
    state.error_sanitized = p.p_error;
    return reply(true);
  }
  if (url.pathname === "/rest/v1/stripe_recebimentos") {
    if (databaseFails) {
      return reply({ message: "fixture DB failure", code: "XX000" }, 500);
    }
    if (request.method === "GET") {
      const filter = url.searchParams.get("stripe_id") || "";
      return reply(
        [...rows.values()].filter((row) =>
          filter
            ? filter.includes(row.stripe_id)
            : row.raw?.balance_status === "pending"
        ),
      );
    }
    assert.equal(request.method, "POST");
    assert.equal(url.searchParams.get("on_conflict"), "stripe_id");
    for (const row of payload as Row[]) {
      const old = rows.get(row.stripe_id);
      if (old && request.headers.get("prefer")?.includes("ignore-duplicates")) {
        continue;
      }
      rows.set(row.stripe_id, {
        empresa_id: null,
        ...old,
        ...structuredClone(row),
      });
    }
    return reply(null, 201);
  }
  throw new Error(
    "Unexpected fixture request " + request.method + " " + url.pathname,
  );
};

const sync = (await import("../functions/stripe-sync/index.ts")).handler;
const saldo = (await import("../functions/stripe-saldo/index.ts")).handler;
const syncRequest = (body: Row = {}, token = "sync-token", method = "POST") =>
  new Request("https://qa.invalid/sync", {
    method,
    headers: { "x-stripe-sync-key": token, "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
const saldoRequest = (token: string | null = "user-token", method = "POST") =>
  new Request("https://qa.invalid/saldo", {
    method,
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
function reset(twoAccounts = true) {
  calls = [];
  rows = new Map();
  history = new Map();
  fail = new Set();
  throws = new Set();
  holdingAccess = true;
  databaseFails = false;
  stripeBlocked = false;
  checkpointFails = false;
  movements = {};
  Deno.env.set("STRIPE_SECRET_KEY", "rk_live_HOLDING");
  Deno.env.set("STRIPE_SYNC_KEY", "sync-token");
  Deno.env.delete("STRIPE_CLICKDROP_SECRET_KEY");
  Deno.env.delete("STRIPE_CLICKDROP_ACCOUNT_ID");
  if (twoAccounts) {
    Deno.env.set("STRIPE_CLICKDROP_SECRET_KEY", "rk_live_CLICKDROP");
    Deno.env.set("STRIPE_CLICKDROP_ACCOUNT_ID", clickdropId);
  }
  owners = {
    "Bearer rk_live_HOLDING": holdingId,
    "Bearer rk_live_CLICKDROP": clickdropId,
  };
  charges = {
    [holdingId]: [charge("ch_holding", 1990)],
    [clickdropId]: [charge("ch_clickdrop", 9990)],
  };
  balances = {
    [holdingId]: {
      livemode: true,
      available: [{ currency: "brl", amount: 2000 }],
      pending: [{ currency: "brl", amount: 500 }],
    },
    [clickdropId]: {
      livemode: true,
      available: [{ currency: "brl", amount: 0 }],
      pending: [{ currency: "brl", amount: 9552 }],
    },
  };
}
const stripeCalls = () =>
  calls.filter((call) => call.url.hostname === "api.stripe.com");

Deno.test("legacy holding keeps the existing secret and unassigned receipts", async () => {
  reset(false);
  const response = await sync(syncRequest()), data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.contas.length, 1);
  assert.equal(data.synced, 1);
  assert.equal(rows.get("ch_holding")?.empresa_id, null);
  assert.equal(stripeAccounts()[0].key, "rk_live_HOLDING");
});

Deno.test("both accounts import once with verified origin and automatic ClickDrop assignment", async () => {
  reset();
  const response = await sync(syncRequest()), data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.synced, 2);
  assert.equal(data.contas.length, 2);
  const row = rows.get("ch_clickdrop")!;
  assert.equal(row.empresa_id, "clickdrop");
  assert.equal(row.raw.account_id, clickdropId);
  assert.equal(row.raw.account_source, "clickdrop");
  assert.equal(row.valor, 99.9);
  assert.equal(row.taxa, 4.38);
  assert.equal(row.valor_liquido, 95.52);
  assert.equal(rows.get("ch_holding")?.raw.account_id, holdingId);
  assert.equal(JSON.stringify(data).includes("rk_live_"), false);
});

Deno.test("replay preserves manual assignment and manual null while updating financial values", async () => {
  reset();
  await sync(syncRequest());
  rows.get("ch_holding")!.empresa_id = "priva_br";
  for (const assigned of ["arcade_hub", "aporte:SAROM", null]) {
    rows.get("ch_clickdrop")!.empresa_id = assigned;
    charges[clickdropId][0].amount = 10000;
    await sync(syncRequest());
    assert.equal(rows.size, 2);
    assert.equal(rows.get("ch_clickdrop")?.empresa_id, assigned);
    assert.equal(rows.get("ch_clickdrop")?.valor, 100);
    assert.equal(rows.get("ch_holding")?.empresa_id, "priva_br");
  }
  const clickWrites = calls.filter((call) =>
    Array.isArray(call.payload) &&
    call.payload.some((row) => row.stripe_id === "ch_clickdrop")
  );
  assert.ok(
    clickWrites.some((call) =>
      call.prefer?.includes("ignore-duplicates") &&
      (call.payload as Row[])[0].empresa_id === "clickdrop"
    ),
  );
  assert.ok(
    clickWrites.some((call) =>
      !call.prefer?.includes("ignore-duplicates") &&
      !("empresa_id" in (call.payload as Row[])[0])
    ),
  );
});

Deno.test("configured ClickDrop without expected account ID produces a visible partial error", async () => {
  reset();
  Deno.env.delete("STRIPE_CLICKDROP_ACCOUNT_ID");
  const response = await sync(syncRequest()), data = await response.json();
  assert.equal(response.status, 502);
  assert.equal(data.parcial, true);
  assert.equal(data.contas[1].ok, false);
  assert.match(data.contas[1].error, /identificação/);
  assert.equal(rows.has("ch_holding"), true);
  assert.equal(rows.has("ch_clickdrop"), false);
  assert.equal(
    stripeCalls().some((call) =>
      call.authorization === "Bearer rk_live_CLICKDROP"
    ),
    false,
  );
});

Deno.test("wrong account key is rejected before reading charges or counting its balance", async () => {
  reset();
  owners["Bearer rk_live_CLICKDROP"] = holdingId;
  const syncData = await (await sync(syncRequest())).json();
  assert.match(syncData.contas[1].error, /outra conta/);
  assert.equal(rows.size, 1);
  const balanceData = await (await saldo(saldoRequest())).json();
  assert.equal(balanceData.saldo.disponivel, 20);
  assert.equal(balanceData.parcial, true);
  assert.equal(
    stripeCalls().some((call) =>
      call.authorization === "Bearer rk_live_CLICKDROP" &&
      call.path !== "/v1/account"
    ),
    false,
  );
});

Deno.test("duplicate holding identity in ClickDrop config cannot double-count the holding", async () => {
  reset();
  owners["Bearer rk_live_CLICKDROP"] = holdingId;
  Deno.env.set("STRIPE_CLICKDROP_ACCOUNT_ID", holdingId);
  const data = await (await saldo(saldoRequest())).json();
  assert.equal(data.parcial, true);
  assert.equal(data.contas[1].ok, false);
  assert.equal(data.saldo.disponivel, 20);
  assert.equal(data.saldo.a_liberar, 5);
  await sync(syncRequest());
  assert.equal(rows.get("ch_holding")?.raw.account_source, "arcade_hub");
  assert.equal(
    stripeCalls().some((call) =>
      call.authorization === "Bearer rk_live_CLICKDROP"
    ),
    false,
  );
});

Deno.test("sync authenticates dedicated secret and method before any provider or database access", async () => {
  reset();
  for (const token of ["", "bad-token"]) {
    assert.equal((await sync(syncRequest({}, token))).status, 401);
  }
  assert.equal((await sync(syncRequest({}, "sync-token", "GET"))).status, 405);
  Deno.env.delete("STRIPE_SYNC_KEY");
  assert.equal((await sync(syncRequest())).status, 401);
  assert.equal(calls.length, 0);
});

Deno.test("saldo rejects absent invalid or non-holding user before Stripe access", async () => {
  reset();
  assert.equal((await saldo(saldoRequest(null))).status, 401);
  assert.equal((await saldo(saldoRequest("invalid"))).status, 401);
  holdingAccess = false;
  assert.equal((await saldo(saldoRequest())).status, 403);
  assert.equal(stripeCalls().length, 0);
});

Deno.test("saldo preflight and method reject no provider access", async () => {
  reset();
  assert.equal((await saldo(saldoRequest(null, "OPTIONS"))).status, 200);
  assert.equal((await saldo(saldoRequest(null, "GET"))).status, 405);
  assert.equal(calls.length, 0);
});

for (const failedAccount of [holdingId, clickdropId]) {
  Deno.test("sync isolates failed charges for " + failedAccount, async () => {
    reset();
    fail.add(failedAccount + "/v1/charges");
    const response = await sync(syncRequest()), data = await response.json();
    assert.equal(response.status, 502);
    assert.equal(data.parcial, true);
    assert.equal(rows.size, 1);
    assert.equal(
      rows.has(failedAccount === holdingId ? "ch_clickdrop" : "ch_holding"),
      true,
    );
  });
}

Deno.test("saldo aggregates BRL only and separates pending from available", async () => {
  reset();
  balances[holdingId].available.push({ currency: "usd", amount: 999999 });
  balances[clickdropId].pending.push({ currency: "eur", amount: 888888 });
  const response = await saldo(saldoRequest()), data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.parcial, false);
  assert.equal(data.contas.length, 2);
  assert.deepEqual(data.saldo, {
    disponivel: 20,
    a_liberar: 100.52,
    total: 120.52,
    moeda: "BRL",
  });
  assert.equal(data.contas[1].saldo.disponivel, 0);
  assert.equal(data.contas[1].saldo.a_liberar, 95.52);
  assert.equal(JSON.stringify(data).includes("rk_live_"), false);
  assert.equal(
    stripeBalance({ available: [{ currency: "usd", amount: 1000 }] })
      .disponivel,
    0,
  );
});

for (const failedAccount of [holdingId, clickdropId]) {
  Deno.test(
    "saldo labels partial sum when " + failedAccount + " fails",
    async () => {
      reset();
      fail.add(failedAccount + "/v1/balance");
      const response = await saldo(saldoRequest()),
        data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.parcial, true);
      assert.equal(data.contas.filter((account: Row) => !account.ok).length, 1);
      assert.equal(data.saldo.disponivel, failedAccount === holdingId ? 0 : 20);
    },
  );
}

Deno.test("both failed balances produce explicit failure without a fake zero balance", async () => {
  reset();
  fail.add(holdingId + "/v1/balance");
  fail.add(clickdropId + "/v1/balance");
  const response = await saldo(saldoRequest()), data = await response.json();
  assert.equal(response.status, 502);
  assert.equal(data.ok, false);
  assert.equal(data.saldo_ok, false);
  assert.equal("saldo" in data, false);
});

Deno.test("provider exceptions are sanitized without exposing keys", async () => {
  reset();
  throws.add("Bearer rk_live_CLICKDROP");
  const response = await sync(syncRequest()), text = await response.text();
  assert.equal(response.status, 502);
  assert.equal(text.includes("rk_live_CLICKDROP"), false);
  assert.match(text, /Não foi possível consultar esta conta Stripe/);
});

Deno.test("test-mode charge cannot become production revenue", async () => {
  reset();
  charges[clickdropId][0].livemode = false;
  const response = await sync(syncRequest()), data = await response.json();
  assert.equal(response.status, 502);
  assert.match(data.contas[1].error, /teste/);
  assert.equal(rows.has("ch_clickdrop"), false);
});

Deno.test("test-mode key is rejected before provider access", async () => {
  reset();
  Deno.env.set("STRIPE_CLICKDROP_SECRET_KEY", "rk_test_CLICKDROP");
  const data = await (await sync(syncRequest())).json();
  assert.equal(data.contas[1].ok, false);
  assert.equal(
    stripeCalls().some((call) =>
      call.authorization === "Bearer rk_test_CLICKDROP"
    ),
    false,
  );
});

Deno.test("test-mode balance cannot enter production Caixa Atual", async () => {
  reset();
  balances[clickdropId].livemode = false;
  const data = await (await saldo(saldoRequest())).json();
  assert.equal(data.parcial, true);
  assert.equal(data.saldo.disponivel, 20);
  assert.equal(data.saldo.a_liberar, 5);
  assert.equal(data.contas[1].ok, false);
});

Deno.test("existing different origin is not overwritten", async () => {
  reset();
  rows.set("ch_clickdrop", {
    stripe_id: "ch_clickdrop",
    empresa_id: "jogadaca",
    raw: { account_id: "acct_OtherFixture" },
    valor: 42,
  });
  const data = await (await sync(syncRequest())).json();
  assert.match(data.contas[1].error, /outra conta/);
  assert.equal(rows.get("ch_clickdrop")?.valor, 42);
  assert.equal(rows.get("ch_clickdrop")?.empresa_id, "jogadaca");
});

Deno.test("each account owns its record limit and pagination cursor", async () => {
  reset();
  charges[holdingId] = Array.from(
    { length: 101 },
    (_, i) => charge("ch_h" + i, 1000),
  );
  let data = await (await sync(syncRequest())).json();
  assert.equal(data.synced, 101);
  assert.equal(rows.size, 101);
  assert.equal(rows.has("ch_clickdrop"), true);
  calls = [];
  data = await (await sync(syncRequest({ full: true }))).json();
  assert.equal(data.synced, 102);
  assert.equal(rows.size, 102);
  const holdingPages = stripeCalls().filter((call) =>
    call.path === "/v1/charges" &&
    call.authorization === "Bearer rk_live_HOLDING"
  );
  const clickPage = stripeCalls().find((call) =>
    call.path === "/v1/charges" &&
    call.authorization === "Bearer rk_live_CLICKDROP"
  )!;
  assert.equal(holdingPages.length, 2);
  assert.equal(
    holdingPages[1].url.searchParams.get("starting_after"),
    "ch_h99",
  );
  assert.equal(clickPage.url.searchParams.has("starting_after"), false);
});

Deno.test("database failures return explicit errors without exposing data", async () => {
  reset();
  databaseFails = true;
  const response = await sync(syncRequest()), data = await response.json();
  assert.equal(response.status, 502);
  assert.equal(data.ok, false);
  assert.equal(data.parcial, false);
  assert.equal(rows.size, 0);
  assert.match(data.contas[0].error, /origem/);
});

Deno.test("historical round persists cursor and resumes beyond recent 100 without duplicates", async () => {
  reset();
  charges[holdingId] = Array.from(
    { length: 1105 },
    (_, i) => charge("ch_h" + i, 1000),
  );
  rows.set("ch_h1104", {
    stripe_id: "ch_h1104",
    empresa_id: "jogadaca",
    status: "approved",
    raw: { account_id: holdingId },
    valor: 10,
  });
  charges[holdingId][1104].refunded = true;
  charges[holdingId][1104].amount_refunded = 1000;
  let data = await (await sync(syncRequest({ historical: true }))).json();
  assert.equal(data.contas[0].historico.complete, false);
  assert.equal(data.contas[0].historico.next_cursor, "ch_h999");
  assert.equal(history.get("arcade_hub")?.cursor_full, "ch_h999");
  assert.equal(
    rows.get("ch_h1104")?.status,
    "approved",
    "unfinished coverage must not claim the old charge was reviewed",
  );
  data = await (await sync(syncRequest())).json();
  assert.equal(data.contas[0].historico.complete, true);
  assert.equal(history.get("arcade_hub")?.complete, true);
  assert.equal(rows.size, 1106);
  assert.equal(rows.get("ch_h1104")?.empresa_id, "jogadaca");
  assert.equal(rows.get("ch_h1104")?.status, "refunded");
  assert.equal(rows.get("ch_h1104")?.valor, 0);
});

Deno.test("failed historical checkpoint leaves round incomplete and retry is idempotent", async () => {
  reset(false);
  checkpointFails = true;
  let response = await sync(syncRequest({ full: true }));
  assert.equal(response.status, 502);
  assert.equal(history.get("arcade_hub")?.complete, false);
  assert.equal(rows.size, 1);
  checkpointFails = false;
  response = await sync(syncRequest());
  assert.equal(response.status, 200);
  assert.equal(history.get("arcade_hub")?.complete, true);
  assert.equal(rows.size, 1);
});

Deno.test("balance preserves allowed aggregate but hides account and history details for Stripe-blocked holding", async () => {
  reset();
  stripeBlocked = true;
  const data = await (await saldo(saldoRequest())).json();
  assert.equal(data.saldo.disponivel, 20);
  assert.equal(data.saldo.a_liberar, 100.52);
  assert.equal(data.conta.nome, "Stripe");
  for (
    const field of [
      "contas",
      "historico",
      "liberacoes",
      "movimentos",
      "movimentos_cobertura",
    ]
  ) {
    assert.equal(field in data, false);
  }
  assert.equal(
    calls.some((call) =>
      call.path === "/rest/v1/stripe_sync_state" ||
      call.path === "/rest/v1/stripe_recebimentos"
    ),
    false,
  );
  assert.equal(
    stripeCalls().some((call) => call.path === "/v1/balance_transactions"),
    false,
  );
});

Deno.test("statement exposes only minimal signed financial fields with explicit limited coverage", async () => {
  reset();
  movements[holdingId] = {
    has_more: true,
    data: [{
      id: "txn_fee",
      type: "stripe_fee",
      amount: -14,
      fee: 0,
      net: -14,
      currency: "brl",
      status: "available",
      created: 1794656880,
      description: "PII secret",
      source: { email: "private@example.invalid" },
    }],
  };
  movements[clickdropId] = {
    has_more: false,
    data: [{
      id: "txn_payout",
      type: "payout",
      amount: -1000,
      fee: 25,
      net: -1025,
      currency: "usd",
      status: "available",
      created: 1794656881,
    }],
  };
  const data = await (await saldo(saldoRequest())).json();
  assert.deepEqual(data.movimentos[1], {
    conta_id: "arcade_hub",
    id: "txn_fee",
    tipo: "stripe_fee",
    valor: -0.14,
    taxa: 0,
    liquido: -0.14,
    moeda: "BRL",
    status: "available",
    data: new Date(1794656880 * 1000).toISOString(),
  });
  assert.equal(data.movimentos[0].liquido, -10.25);
  assert.equal(data.movimentos[0].moeda, "USD");
  assert.equal(data.movimentos_cobertura.completa, false);
  assert.equal(data.movimentos_cobertura.limite_por_conta, 100);
  assert.equal(data.movimentos_erro, null);
  assert.equal(JSON.stringify(data).includes("private@"), false);
  assert.equal(JSON.stringify(data).includes("PII secret"), false);
});

Deno.test("statement failure preserves valid balance and other account rows with safe error", async () => {
  reset();
  fail.add(holdingId + "/v1/balance_transactions");
  movements[clickdropId] = {
    has_more: false,
    data: [{
      id: "txn_sale",
      type: "charge",
      amount: 9990,
      fee: 438,
      net: 9552,
      currency: "brl",
      status: "pending",
      created: 1794656880,
    }],
  };
  const response = await saldo(saldoRequest()), data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.saldo.disponivel, 20);
  assert.equal(data.movimentos.length, 1);
  assert.equal(typeof data.movimentos_erro, "string");
  assert.equal(
    data.movimentos_cobertura.contas.find((a: Row) =>
      a.conta_id === "arcade_hub"
    ).ok,
    false,
  );
  assert.equal(JSON.stringify(data).includes("rk_live_"), false);
});

Deno.test("malformed statement values are not converted to trustworthy zeros", async () => {
  reset(false);
  movements[holdingId] = {
    has_more: false,
    data: [{
      id: "txn_bad",
      type: "stripe_fee",
      amount: null,
      fee: 0,
      net: 0,
      currency: "brl",
      status: "available",
      created: 1794656880,
    }],
  };
  const data = await (await saldo(saldoRequest())).json();
  assert.deepEqual(data.movimentos, []);
  assert.equal(typeof data.movimentos_erro, "string");
  assert.equal(data.saldo.disponivel, 20);
});

Deno.test("known release dates are identified as partial charge coverage, never bank payout promises", async () => {
  reset();
  charges[clickdropId][0].balance_transaction.available_on = 1797206400;
  charges[clickdropId][0].balance_transaction.status = "pending";
  await sync(syncRequest());
  const row = rows.get("ch_clickdrop")!;
  assert.equal(row.raw.available_on, new Date(1797206400 * 1000).toISOString());
  assert.equal(row.raw.balance_status, "pending");
  const data = await (await saldo(saldoRequest())).json();
  assert.equal(data.liberacoes.length, 1);
  assert.equal(data.liberacoes[0].valor, 95.52);
  assert.equal(data.liberacoes[0].conta_id, "clickdrop");
  assert.equal(data.liberacoes_cobertura.completa, false);
  assert.match(data.liberacoes_cobertura.aviso, /repasse bancário/);
  assert.equal(data.atualizado_em, null);
});
