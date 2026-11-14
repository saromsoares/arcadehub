import { createClient } from "npm:@supabase/supabase-js@2.117.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

async function requireHolding(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || token === authorization) {
    return json({ ok: false, error: "Entre novamente no dashboard." }, 401);
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return json({ ok: false, error: "Entre novamente no dashboard." }, 401);
  }
  const access = await admin.from("usuarios_empresas").select("empresa_id").eq(
    "user_id",
    data.user.id,
  ).eq("empresa_id", "arcade_hub").maybeSingle();
  if (access.error) {
    return json(
      { ok: false, error: "Não foi possível verificar o acesso." },
      503,
    );
  }
  if (!access.data) {
    return json({ ok: false, error: "A conta do Nubank é da holding." }, 403);
  }
  return null;
}

type ContaPluggy = {
  id?: string;
  name?: string;
  type?: string;
  subtype?: string;
  currencyCode?: string;
  balance?: number;
  number?: string;
};

function digitos(value: string) {
  return value.replace(/\D/g, "");
}

export function escolherContaCorrente(
  contas: ContaPluggy[],
  expectedId = (Deno.env.get("PLUGGY_ACCOUNT_ID") || "").trim(),
) {
  const correntes = contas.filter((conta) =>
    String(conta.type || "").toUpperCase() === "BANK" &&
    String(conta.subtype || "").toUpperCase() === "CHECKING_ACCOUNT" &&
    String(conta.currencyCode || "").toUpperCase() === "BRL" &&
    typeof conta.balance === "number" &&
    Number.isFinite(conta.balance)
  );
  if (expectedId) {
    return correntes.find((conta) => conta.id === expectedId) || null;
  }
  // Backwards-compatible identity, never an arbitrary first checking account.
  const accountNumber = (value: string) =>
    digitos(value.split("/").at(-1) || "").replace(/^0+/, "");
  const matches = correntes.filter((conta) =>
    accountNumber(String(conta.number || "")) === "8234913904"
  );
  return matches.length === 1 ? matches[0] : null;
}

async function chavePluggy(clientId: string, clientSecret: string) {
  const response = await fetch("https://api.pluggy.ai/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return null;
  const body = await response.json();
  const apiKey = typeof body?.apiKey === "string" && body.apiKey
    ? body.apiKey
    : typeof body?.accessToken === "string" && body.accessToken
    ? body.accessToken
    : null;
  return apiKey;
}

async function contasDoItem(apiKey: string, itemId: string) {
  const contas: ContaPluggy[] = [];
  for (let page = 1; page <= 3; page++) {
    const response = await fetch(
      `https://api.pluggy.ai/accounts?itemId=${
        encodeURIComponent(itemId)
      }&page=${page}`,
      { headers: { "X-API-KEY": apiKey }, signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) return null;
    const body = await response.json();
    const results = Array.isArray(body?.results) ? body.results : [];
    contas.push(...results);
    const totalPages = Number(body?.totalPages || 1);
    if (!Number.isFinite(totalPages) || page >= totalPages) break;
  }
  return contas;
}

async function atualizadoEm(apiKey: string, itemId: string) {
  const response = await fetch(
    `https://api.pluggy.ai/items/${encodeURIComponent(itemId)}`,
    {
      headers: { "X-API-KEY": apiKey },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) return null;
  const body = await response.json();
  const timestamp = typeof body?.lastUpdatedAt === "string"
    ? Date.parse(body.lastUpdatedAt)
    : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export const handler = async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ ok: false, error: "Método não permitido." }, 405);
  }
  const denied = await requireHolding(req);
  if (denied) return denied;

  const clientId = (Deno.env.get("PLUGGY_CLIENT_ID") || "").trim();
  const clientSecret = (Deno.env.get("PLUGGY_CLIENT_SECRET") || "").trim();
  const itemId = (Deno.env.get("PLUGGY_ITEM_ID") || "").trim();
  if (!clientId || !clientSecret || !itemId) {
    return json({
      ok: false,
      error: "A leitura do Nubank ainda não foi configurada no servidor.",
    }, 503);
  }

  try {
    const apiKey = await chavePluggy(clientId, clientSecret);
    if (!apiKey) {
      return json(
        { ok: false, error: "A Pluggy recusou as credenciais." },
        502,
      );
    }
    const contas = await contasDoItem(apiKey, itemId);
    if (!contas) {
      return json(
        { ok: false, error: "A Pluggy recusou a consulta de saldo." },
        502,
      );
    }
    const conta = escolherContaCorrente(contas);
    if (!conta || typeof conta.balance !== "number") {
      return json({
        ok: false,
        error: "A conta corrente do Nu Empresas ainda não apareceu na Pluggy.",
      }, 502);
    }
    const atualizado = await atualizadoEm(apiKey, itemId);
    return json({
      ok: true,
      saldo_ok: true,
      origem: "pluggy",
      conta: {
        id: conta.id || null,
        nome: "Nu Empresas",
        nome_fonte: conta.name || null,
        numero: conta.number || null,
        moeda: conta.currencyCode || "BRL",
      },
      saldo: { disponivel: conta.balance, moeda: "BRL" },
      atualizado_em: atualizado,
      saldo_referencia_em: atualizado,
      desatualizado: !atualizado ||
        Date.now() - Date.parse(atualizado) > 24 * 60 * 60 * 1000,
      consultado_em: new Date().toISOString(),
    });
  } catch {
    return json(
      { ok: false, error: "Não foi possível consultar o Nubank." },
      502,
    );
  }
};

if (import.meta.main) Deno.serve(handler);
