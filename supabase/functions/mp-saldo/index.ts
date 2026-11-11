import { createClient } from "npm:@supabase/supabase-js@2.117.0";

const MP_TOKEN = Deno.env.get("MP_ACCESS_TOKEN") ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function numeroMercadoPago(valor: unknown): number | null {
  const n = typeof valor === "number" ? valor : typeof valor === "string" ? parseFloat(valor) : NaN;
  return Number.isFinite(n) ? n : null;
}

function lerSaldoMercadoPago(corpo: unknown) {
  if (!corpo || typeof corpo !== "object") return null;
  const bruto = corpo as Record<string, unknown>;
  const fonte = bruto.data && typeof bruto.data === "object" ? bruto.data as Record<string, unknown> : bruto;
  const disponivel = numeroMercadoPago(fonte.available_balance ?? fonte.available ?? fonte.availableBalance);
  const pendente = numeroMercadoPago(fonte.unavailable_balance ?? fonte.unavailable ?? fonte.unavailableBalance ?? fonte.pending);
  let total = numeroMercadoPago(fonte.total_amount ?? fonte.total ?? fonte.totalBalance);
  if (total === null && (disponivel !== null || pendente !== null)) total = (disponivel ?? 0) + (pendente ?? 0);
  if (disponivel === null && total === null) return null;
  return { available_balance: disponivel, unavailable_balance: pendente, total_amount: total };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function requireMercadoPago(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || token === authorization) return json({ ok: false, error: "Entre novamente no dashboard." }, 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json({ ok: false, error: "Entre novamente no dashboard." }, 401);
  const access = await admin.from("usuarios_empresas").select("empresa_id").eq("user_id", data.user.id).eq("empresa_id", "arcade_hub").maybeSingle();
  if (access.error) return json({ ok: false, error: "Não foi possível verificar o acesso." }, 503);
  if (!access.data) return json({ ok: false, error: "A conta Mercado Pago é da holding." }, 403);
  return null;
}

export const handler = async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const denied = await requireMercadoPago(req);
  if (denied) return denied;
  try {
    if (!MP_TOKEN) return json({ ok: false, error: "MP_ACCESS_TOKEN nao configurado" }, 500);
    const auth = { Authorization: `Bearer ${MP_TOKEN}` };
    const meResponse = await fetch("https://api.mercadopago.com/users/me", { headers: { ...auth, Accept: "application/json" } });
    const me = await meResponse.json().catch(() => null);
    if (!me?.id) return json({ ok: false, error: "token invalido ou sem permissao" }, 502);
    const balanceResponse = await fetch(`https://api.mercadopago.com/users/${me.id}/mercadopago_account/balance`, {
      headers: { ...auth, Accept: "application/json" },
    });
    let saldo: { available_balance: number | null; unavailable_balance: number | null; total_amount: number | null } | null = null;
    let saldoOk = false;
    let saldoErro: string | null = null;
    if (balanceResponse.status === 403) {
      saldoErro = "sem_permissao";
    } else if (balanceResponse.ok) {
      saldo = lerSaldoMercadoPago(await balanceResponse.json().catch(() => null));
      saldoOk = saldo !== null;
      if (!saldoOk) saldoErro = "indisponivel";
    } else {
      saldoErro = "indisponivel";
    }
    return json({
      ok: true,
      conta: { nickname: me.nickname ?? null },
      saldo_ok: saldoOk,
      saldo,
      saldo_erro: saldoErro,
      consultado_em: new Date().toISOString(),
    });
  } catch (error) {
    return json({ ok: false, error: String(error) }, 500);
  }
};

if (import.meta.main) Deno.serve(handler);
