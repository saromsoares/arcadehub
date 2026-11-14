import { dashboardAdmin, dashboardBody, dashboardEndpoint, dashboardHolding, dashboardId, dashboardJson, dashboardMaster, dashboardRpcError, dashboardUser, DashboardError } from "../_shared/dashboard-auth.ts";

const metadata = ["empresa_id","empresa_nome","rotulo","url","usuario","obs","ordem","request_id","review_due_at"];
export const handler = dashboardEndpoint(async req => {
  const user = await dashboardUser(req);
  await dashboardHolding(user.id);
  const input = await dashboardBody(req);
  const action = String(input.action || "");
  if (action === "verify") { await dashboardMaster(input.mestra); return dashboardJson({ok:true}); }
  if (!["save","delete","review","events","clear_secret"].includes(action)) throw new DashboardError(400,"Ação inválida.");
  const id = dashboardId(input.id, !["save","events"].includes(action));
  const raw = input.access && typeof input.access === "object" ? input.access : {};
  const payload: Record<string,unknown> = {};
  for (const key of metadata) if (Object.hasOwn(raw,key)) {
    if (key === "ordem") {
      if (!Number.isSafeInteger(raw[key]) || Math.abs(raw[key])>100000) throw new DashboardError(400,"Ordem inválida.");
      payload[key] = raw[key];
    } else {
      if (typeof raw[key] !== "string" && raw[key] !== null) throw new DashboardError(400,"Campo de acesso inválido.");
      payload[key] = raw[key] === null ? null : String(raw[key]).trim().slice(0,key==="obs"?5000:2000);
    }
  }
  if (payload.url && !/^https?:\/\//i.test(String(payload.url))) throw new DashboardError(400,"Use uma URL http ou https.");
  if (Object.hasOwn(raw,"senha") && raw.senha !== "") {
    if (typeof raw.senha !== "string" || raw.senha.length>10000 || /\0/.test(raw.senha)) throw new DashboardError(400,"Senha inválida.");
    await dashboardMaster(input.mestra); payload.senha=raw.senha;
  }
  if (["delete","clear_secret"].includes(action)) await dashboardMaster(input.mestra);
  if (action==="save" && !id) payload.request_id=dashboardId(input.request_id || raw.request_id,true);
  if (action==="review") payload.review_due_at=input.review_due_at || null;
  const result = await dashboardAdmin.rpc("dashboard_access_action",{p_actor:user.id,p_action:action,p_id:id,p_payload:payload});
  dashboardRpcError(result.error);
  return dashboardJson({ok:true,...result.data});
});
if (import.meta.main) Deno.serve(handler);
