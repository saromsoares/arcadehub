import { dashboardAdmin, dashboardBody, dashboardEndpoint, dashboardId, dashboardJson, dashboardRpcError, dashboardUser, DashboardError } from "../_shared/dashboard-auth.ts";

const fields = ["empresa_id","nome","email","telefone","regiao","observacao","status","responsavel","proxima_acao","proxima_acao_em"];
export const handler = dashboardEndpoint(async req => {
  const user=await dashboardUser(req), input=await dashboardBody(req), action=String(input.action || "");
  const id=dashboardId(input.id || input.lead_id);
  let rpc="",operation="",payload:Record<string,unknown>={};
  if (["save_lead","convert_contact","lead_history"].includes(action)) {
    rpc="dashboard_lead_action"; operation=action==="lead_history"?"history":action;
    if (action==="lead_history" && !id) throw new DashboardError(400,"Lead obrigatório.");
    if (action!=="lead_history") {
      const raw=input.lead && typeof input.lead==="object"?input.lead:{};
      const lead:Record<string,unknown>={};
      for(const field of fields) if(Object.hasOwn(raw,field)) {
        if(typeof raw[field]!=="string" && raw[field]!==null) throw new DashboardError(400,"Campo de lead inválido.");
        lead[field]=raw[field]===null?null:String(raw[field]).trim().slice(0,field==="observacao"?10000:2000);
      }
      if (lead.proxima_acao_em && !Number.isFinite(Date.parse(String(lead.proxima_acao_em)))) throw new DashboardError(400,"Data da próxima ação inválida.");
      payload={lead,request_id:dashboardId(input.request_id,!id)};
      if(action==="convert_contact") {payload.contato_id=dashboardId(input.contato_id,true);payload.empresa_id=String(input.empresa_id || "");}
    }
  } else if (["list_reimbursements","record_reimbursement","cancel_reimbursement"].includes(action)) {
    rpc="dashboard_reimbursement_action";
    operation=action==="list_reimbursements"?"list":action==="record_reimbursement"?"record":"cancel";
    if(operation==="list") {
      const year=Number(input.ano || new Date().getFullYear());
      if(!Number.isSafeInteger(year)||year<2000||year>2100) throw new DashboardError(400,"Exercício inválido.");
      payload={ano:year};
    } else if(operation==="cancel") {
      if(!id) throw new DashboardError(400,"Reembolso obrigatório.");
      payload={reason:String(input.reason || "").slice(0,500)};
    } else {
      const payment=input.payment || {};
      if(typeof payment.valor!=="number" || !Number.isFinite(payment.valor)) throw new DashboardError(400,"Valor inválido.");
      payload={request_id:dashboardId(input.request_id,true),payment:{
        socio:String(payment.socio || ""),valor:payment.valor,data_pagamento:String(payment.data_pagamento || ""),
        referencia:String(payment.referencia || "").trim().slice(0,300),observacao:String(payment.observacao || "").slice(0,2000),
        origem_ref:payment.origem_ref?String(payment.origem_ref):null,
      }};
    }
  } else throw new DashboardError(400,"Ação inválida.");
  const result=await dashboardAdmin.rpc(rpc,{p_actor:user.id,p_action:operation,p_id:id,p_payload:payload});
  dashboardRpcError(result.error);
  if(result.data?.error==="duplicate_lead_review_required") return dashboardJson({ok:false,...result.data},409);
  return dashboardJson({ok:true,...result.data});
});
if(import.meta.main) Deno.serve(handler);
