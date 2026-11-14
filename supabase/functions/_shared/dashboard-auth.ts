import { createClient } from "npm:@supabase/supabase-js@2.117.0";

export const dashboardAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
export const dashboardCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export class DashboardError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function dashboardJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...dashboardCors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
export async function dashboardUser(req: Request) {
  const token = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new DashboardError(401, "Entre novamente no dashboard.");
  const { data, error } = await dashboardAdmin.auth.getUser(token);
  if (error || !data.user) throw new DashboardError(401, "Entre novamente no dashboard.");
  return data.user;
}
export async function dashboardHolding(userId: string) {
  const { data, error } = await dashboardAdmin.from("usuarios_empresas").select("empresa_id").eq("user_id", userId).eq("empresa_id", "arcade_hub").maybeSingle();
  if (error) throw new DashboardError(503, "Não foi possível verificar o acesso.");
  if (!data) throw new DashboardError(403, "Este recurso exige acesso à holding.");
}
export async function dashboardMaster(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 1000) throw new DashboardError(401, "Informe a senha mestra.");
  const configured = Deno.env.get("ACESSOS_MASTER_HASH");
  if (!configured || !/^[0-9a-f]{64}$/i.test(configured)) throw new DashboardError(503, "A validação da senha mestra está temporariamente indisponível.");
  const expected = configured.toLowerCase();
  const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, "0")).join("");
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < Math.max(actual.length, expected.length); i++) diff |= (actual.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  if (diff) throw new DashboardError(403, "Senha mestra incorreta.");
}
export async function dashboardBody(req: Request) {
  const text = await req.text();
  if (text.length > 100000) throw new DashboardError(413, "Solicitação muito grande.");
  try {
    const value = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, any>;
  } catch { throw new DashboardError(400, "Solicitação inválida."); }
}
export function dashboardId(value: unknown, required = false) {
  if ((value === undefined || value === null || value === "") && !required) return null;
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new DashboardError(400, "Identificador inválido.");
  return value;
}
export function dashboardRpcError(error: { message?: string; code?: string } | null) {
  if (!error) return;
  const messages: Record<string,string> = {
    holding_access_required: "Este recurso exige acesso à holding.", project_access_required: "Sem acesso ao projeto selecionado.", page_blocked: "Página não autorizada.",
    access_not_found: "Acesso não encontrado.", lead_not_found: "Lead não encontrado.", contact_not_found: "Contato não encontrado.", reimbursement_not_found: "Reembolso não encontrado.",
    request_id_required: "Identificação da tentativa obrigatória.", invalid_action: "Ação inválida.", invalid_reimbursement: "Confira sócio, valor e data do pagamento já realizado.",
    reference_required: "Informe a referência do pagamento.", reimbursement_exceeds_pending: "O valor ultrapassa o saldo pessoal pendente de reembolso.",
    invalid_expense_reference: "A despesa informada não pertence a este sócio e exercício.", cancellation_reason_required: "Informe o motivo da correção.",
    lead_name_required: "Informe o nome do lead.", invalid_lead_status: "Etapa de lead inválida.", lead_project_immutable: "O projeto do lead não pode ser alterado nesta edição.",
  };
  const message = messages[error.message || ""];
  if (message) throw new DashboardError(error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400, message);
  if (error.code === "23505") throw new DashboardError(409, "Este registro já existe. Atualize e revise a duplicidade.");
  throw new DashboardError(503, "Não foi possível confirmar a operação. Preserve os dados e tente novamente.");
}
export function dashboardEndpoint(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: dashboardCors });
    if (req.method !== "POST") return dashboardJson({ ok:false,error:"Método não permitido." },405);
    try { return await fn(req); }
    catch (error) { return dashboardJson({ ok:false,error:error instanceof DashboardError ? error.message : "Não foi possível confirmar a operação." }, error instanceof DashboardError ? error.status : 503); }
  };
}
