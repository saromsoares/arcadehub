import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { majorUnits } from "../_shared/stripe.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-stripe-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function requireHolding(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || token === authorization) return json({ ok: false, error: "Entre novamente no dashboard." }, 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json({ ok: false, error: "Entre novamente no dashboard." }, 401);
  const access = await admin.from("usuarios_empresas").select("empresa_id").eq("user_id", data.user.id).eq("empresa_id", "arcade_hub").maybeSingle();
  if (access.error) return json({ ok: false, error: "Não foi possível verificar o acesso." }, 503);
  if (!access.data) return json({ ok: false, error: "A conta Stripe é da holding." }, 403);
  const blocks = await admin.from("usuarios_paginas_bloqueadas").select("paginas").eq("user_id", data.user.id).maybeSingle();
  if (blocks.error) return json({ ok: false, error: "Não foi possível verificar o acesso." }, 503);
  if ((blocks.data?.paginas || []).includes("stripe")) return json({ ok: false, error: "Esta área não está liberada." }, 403);
  return null;
}

export const handler = async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);
  const denied = await requireHolding(req);
  if (denied) return denied;
  const key = Deno.env.get("STRIPE_SECRET_KEY") || "";
  if (!key) return json({ ok: false, error: "A chave do Stripe ainda não foi configurada no servidor." }, 503);
  try {
    const headers = { Authorization: `Bearer ${key}` };
    const [balanceResponse, accountResponse] = await Promise.all([
      fetch("https://api.stripe.com/v1/balance", { headers }),
      fetch("https://api.stripe.com/v1/account", { headers }),
    ]);
    if (!balanceResponse.ok) return json({ ok: false, error: "O Stripe recusou a consulta de saldo." }, 502);
    const balance = await balanceResponse.json();
    const account = accountResponse.ok ? await accountResponse.json() : {};
    const entries = [...(balance.available || []), ...(balance.pending || [])];
    const currency = entries.some((entry: { currency?: string }) => entry.currency === "brl")
      ? "brl"
      : (entries[0]?.currency || "brl");
    const sum = (list: { amount?: number; currency?: string }[]) =>
      (list || []).filter(entry => entry.currency === currency).reduce((total, entry) => total + Number(entry.amount || 0), 0);
    const disponivel = majorUnits(sum(balance.available || []), currency);
    const aLiberar = majorUnits(sum(balance.pending || []), currency);
    const nome = account?.business_profile?.name || account?.settings?.dashboard?.display_name || "Stripe";
    return json({
      ok: true,
      saldo_ok: true,
      conta: { nome: String(nome) },
      saldo: { disponivel, a_liberar: aLiberar, total: disponivel + aLiberar, moeda: String(currency).toUpperCase() },
      consultado_em: new Date().toISOString(),
    });
  } catch {
    return json({ ok: false, error: "Não foi possível consultar o Stripe." }, 502);
  }
};

if (import.meta.main) Deno.serve(handler);
