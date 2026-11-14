// HTTP fixtures only. Run with --allow-env, never --allow-net.
import assert from "node:assert/strict";
Deno.env.set("SUPABASE_URL", "https://qa.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service");
Deno.env.set("MP_ACCESS_TOKEN", "fixture-mp-token");
Deno.env.set("PLUGGY_CLIENT_ID", "fixture-client");
Deno.env.set("PLUGGY_CLIENT_SECRET", "fixture-secret");
Deno.env.set("PLUGGY_ITEM_ID", "fixture-item");
let holding = true,
  reports: Record<string, unknown>[] = [],
  accounts: Record<string, unknown>[] = [],
  updated: unknown = null;
let directBalance: unknown = null,
  directStatus = 403,
  providerThrows = false,
  calls: string[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
globalThis.fetch = async (
  input: string | URL | Request,
  init?: RequestInit,
) => {
  const request = new Request(input, init), url = new URL(request.url);
  calls.push(url.hostname + url.pathname);
  if (url.hostname === "qa.invalid") {
    if (url.pathname === "/auth/v1/user") {
      return request.headers.get("authorization") === "Bearer fixture-user"
        ? json({
          id: "00000000-0000-4000-8000-000000000001",
          aud: "authenticated",
          role: "authenticated",
        })
        : json({ message: "invalid" }, 401);
    }
    if (url.pathname === "/rest/v1/usuarios_empresas") {
      return json(holding ? [{ empresa_id: "arcade_hub" }] : []);
    }
  }
  if (providerThrows) {
    throw new Error(
      "provider exception includes fixture-mp-token and fixture-secret",
    );
  }
  if (url.hostname === "api.pluggy.ai") {
    if (url.pathname === "/auth") {
      return json({ apiKey: "fixture-provider-key" });
    }
    if (url.pathname === "/accounts") {
      return json({ totalPages: 1, results: accounts });
    }
    if (url.pathname === "/items/fixture-item") {
      return json({ lastUpdatedAt: updated });
    }
  }
  if (url.hostname === "api.mercadopago.com") {
    if (url.pathname === "/users/me") {
      return json({ id: 123, nickname: "Holding fixture" });
    }
    if (url.pathname === "/users/123/mercadopago_account/balance") {
      return json(directBalance, directStatus);
    }
    if (url.pathname === "/v1/account/release_report/list") {
      return json(reports);
    }
    if (url.pathname === "/v1/account/release_report/fixture.csv") {
      return new Response("RECORD_TYPE;BALANCE_AMOUNT\nrelease;68.764,75\n", {
        headers: { "Content-Type": "text/csv" },
      });
    }
    if (
      url.pathname === "/v1/account/release_report" && request.method === "POST"
    ) return json({ created: true }, 202);
  }
  throw new Error("Unexpected fixture path: " + url.hostname + url.pathname);
};
const nubank = (await import("../functions/nubank-saldo/index.ts")).handler;
const mp = (await import("../functions/mp-saldo/index.ts")).handler;
const req = (token = "fixture-user", method = "POST") =>
  new Request("https://qa.invalid/saldo", {
    method,
    headers: { authorization: "Bearer " + token },
  });
function reset() {
  holding = true;
  reports = [];
  accounts = [];
  updated = null;
  directBalance = null;
  directStatus = 403;
  providerThrows = false;
  calls = [];
  Deno.env.delete("PLUGGY_ACCOUNT_ID");
}
const account = (fields: Record<string, unknown> = {}) => ({
  id: "account-expected",
  name: "Nu conta fixture",
  type: "BANK",
  subtype: "CHECKING_ACCOUNT",
  currencyCode: "BRL",
  balance: 302.22,
  number: "823491390-4",
  ...fields,
});

Deno.test("Nubank refuses unrelated checking account instead of accepting first balance", async () => {
  reset();
  accounts = [account({ id: "other", number: "000000000", balance: 777 })];
  const response = await nubank(req());
  assert.equal(response.status, 502);
  assert.equal("saldo" in await response.json(), false);
});
Deno.test("Nubank accepts exact known identity and reports provider timestamps separately", async () => {
  reset();
  accounts = [account()];
  updated = new Date().toISOString();
  const data = await (await nubank(req())).json();
  assert.equal(data.saldo.disponivel, 302.22);
  assert.equal(data.conta.id, "account-expected");
  assert.equal(data.conta.numero, "823491390-4");
  assert.equal(data.atualizado_em, updated);
  assert.equal(data.saldo_referencia_em, updated);
  assert.equal(data.desatualizado, false);
});
Deno.test("Nubank strict identity includes the check digit and accepts only harmless agency formatting", async () => {
  reset();
  for (const number of ["823491390-0", "823491390", "82349139-0"]) {
    accounts = [account({ number })];
    assert.equal((await nubank(req())).status, 502);
  }
  accounts = [account({ number: "0001 / 000823491390-4" })];
  const response = await nubank(req());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).conta.id, "account-expected");
});
Deno.test("explicit Pluggy account ID is authoritative and absence never falls back", async () => {
  reset();
  Deno.env.set("PLUGGY_ACCOUNT_ID", "explicit-id");
  accounts = [account()];
  assert.equal((await nubank(req())).status, 502);
  accounts.push(account({ id: "explicit-id", number: "12345-6", balance: 42 }));
  const data = await (await nubank(req())).json();
  assert.equal(data.conta.id, "explicit-id");
  assert.equal(data.saldo.disponivel, 42);
});
Deno.test("Nubank refuses ambiguous legacy account numbers and unknown currencies", async () => {
  reset();
  accounts = [account(), account({ id: "ambiguous" })];
  assert.equal((await nubank(req())).status, 502);
  accounts = [account({ currencyCode: null })];
  assert.equal((await nubank(req())).status, 502);
});
Deno.test("Nubank unknown or old provider timestamp is marked stale", async () => {
  reset();
  accounts = [account()];
  updated = "bad-date";
  let data = await (await nubank(req())).json();
  assert.equal(data.atualizado_em, null);
  assert.equal(data.desatualizado, true);
  updated = "2020-01-01T00:00:00Z";
  data = await (await nubank(req())).json();
  assert.equal(data.desatualizado, true);
});
Deno.test("MP stale report retains original data reference despite fresh consultation", async () => {
  reset();
  reports = [{
    file_name: "fixture.csv",
    date_created: "2020-02-01T00:00:00Z",
    end_date: "2020-01-31T23:59:59Z",
  }];
  const data = await (await mp(req())).json();
  assert.equal(data.origem, "relatorio");
  assert.equal(data.saldo.available_balance, 68764.75);
  assert.equal(data.saldo_referencia_em, "2020-01-31T23:59:59.000Z");
  assert.equal(data.relatorio_gerado_em, "2020-02-01T00:00:00.000Z");
  assert.equal(data.relatorio_periodo_fim, "2020-01-31T23:59:59.000Z");
  assert.equal(data.referencia_tipo, "fim_periodo");
  assert.equal(data.desatualizado, true);
  assert.notEqual(data.consultado_em, data.saldo_referencia_em);
});
Deno.test("MP report without financial reference never invents an updated timestamp", async () => {
  reset();
  reports = [{
    file_name: "fixture.csv",
    date_created: new Date().toISOString(),
  }];
  const data = await (await mp(req())).json();
  assert.equal(data.saldo_referencia_em, null);
  assert.equal(data.atualizado_em, null);
  assert.equal(data.referencia_tipo, "geracao_relatorio");
  assert.equal(data.desatualizado, false);
});
Deno.test("MP future report window stays period metadata and generation never becomes financial snapshot", async () => {
  reset();
  const created = new Date(Date.now() - 60000).toISOString(),
    future = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  reports = [{
    file_name: "fixture.csv",
    date_created: created,
    end_date: future,
  }];
  const data = await (await mp(req())).json();
  assert.equal(data.saldo.available_balance, 68764.75);
  assert.equal(data.saldo_referencia_em, null);
  assert.equal(data.relatorio_periodo_fim, future);
  assert.equal(data.relatorio_gerado_em, created);
  assert.equal(data.referencia_tipo, "geracao_relatorio");
  assert.equal(data.desatualizado, false);
});
Deno.test("MP missing or future generation without usable period reference remains unknown and stale", async () => {
  reset();
  for (
    const date_created of [
      undefined,
      new Date(Date.now() + 60000).toISOString(),
    ]
  ) {
    reports = [{
      file_name: "fixture.csv",
      date_created,
      end_date: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    }];
    const data = await (await mp(req())).json();
    assert.equal(data.saldo_referencia_em, null);
    assert.equal(data.referencia_tipo, null);
    assert.equal(data.desatualizado, true);
  }
});
Deno.test("MP direct account balance keeps negative amount and identifies account", async () => {
  reset();
  directStatus = 200;
  directBalance = {
    available_balance: -0.28,
    unavailable_balance: 18.86,
    total_amount: 18.58,
  };
  const data = await (await mp(req())).json();
  assert.equal(data.origem, "conta");
  assert.equal(data.saldo.available_balance, -0.28);
  assert.equal(data.conta.id, "123");
  assert.equal(data.desatualizado, false);
});
Deno.test("provider balances reject unauthenticated and non-holding before provider access", async () => {
  reset();
  for (const handler of [nubank, mp]) {
    assert.equal((await handler(req("invalid"))).status, 401);
    holding = false;
    assert.equal((await handler(req())).status, 403);
    holding = true;
  }
  assert.equal(calls.some((path) => !path.startsWith("qa.invalid")), false);
});
Deno.test("provider exceptions never serialize credentials in financial errors", async () => {
  reset();
  providerThrows = true;
  for (const handler of [nubank, mp]) {
    const response = await handler(req()), text = await response.text();
    assert.equal(response.status, 502);
    assert.equal(text.includes("fixture-secret"), false);
    assert.equal(text.includes("fixture-mp-token"), false);
  }
});
