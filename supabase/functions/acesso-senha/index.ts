import { dashboardAdmin, dashboardBody, dashboardEndpoint, dashboardHolding, dashboardId, dashboardJson, dashboardMaster, dashboardRpcError, dashboardUser, DashboardError } from "../_shared/dashboard-auth.ts";

export const handler = dashboardEndpoint(async req => {
  const user = await dashboardUser(req);
  await dashboardHolding(user.id);
  const input = await dashboardBody(req);
  const id = dashboardId(input.id, true);
  await dashboardMaster(input.mestra);
  const action = input.action === "copiar" ? "copiar" : "revelar";
  const result = await dashboardAdmin.rpc("dashboard_access_action", { p_actor:user.id,p_action:action,p_id:id,p_payload:{} });
  if (result.error && Deno.env.get("ACESSOS_LEGACY_COMPAT") === "true" && ["PGRST202","42883"].includes(result.error.code || "")) {
    // Explicit rollout-only fallback. Session, holding and master are already checked.
    // Disable ACESSOS_LEGACY_COMPAT after the private RPC migration is verified.
    const legacy = await dashboardAdmin.from("acessos_empresas").select("id,senha").eq("id",id).maybeSingle();
    if (legacy.error) throw new DashboardError(503,"Não foi possível consultar este acesso.");
    if (!legacy.data) throw new DashboardError(404,"Acesso não encontrado.");
    return dashboardJson({ senha:legacy.data.senha || "", compat:true });
  }
  dashboardRpcError(result.error);
  return dashboardJson({ senha:typeof result.data?.senha === "string" ? result.data.senha : "" });
});
if (import.meta.main) Deno.serve(handler);
