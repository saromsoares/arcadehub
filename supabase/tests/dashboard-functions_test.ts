// All Auth/PostgREST is mocked; no --allow-net and no production credentials.
import assert from "node:assert/strict";
Deno.env.set("SUPABASE_URL","https://qa.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","fixture-service");
const master="fixture-master";
Deno.env.set("ACESSOS_MASTER_HASH",[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(master)))].map(x=>x.toString(16).padStart(2,"0")).join(""));
Deno.env.delete("ACESSOS_LEGACY_COMPAT");
const uid="00000000-0000-4000-8000-000000000001", id="10000000-0000-4000-8000-000000000001", requestId="20000000-0000-4000-8000-000000000001";
type Row=Record<string,any>;
let calls:Row[]=[],holding=true,rpcFailure:Row|null=null,rpcData:Row={},legacyRead=false;
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
globalThis.fetch=async(input:string|URL|Request,init?:RequestInit)=>{
  const req=new Request(input,init),url=new URL(req.url); assert.equal(url.hostname,"qa.invalid");
  const body=req.method==="POST"?await req.json():undefined;
  calls.push({path:url.pathname,body,method:req.method});
  if(url.pathname==="/auth/v1/user")return req.headers.get("authorization")==="Bearer user-token"?response({id:uid,role:"authenticated",aud:"authenticated",app_metadata:{},user_metadata:{}}):response({message:"Invalid token"},401);
  if(url.pathname==="/rest/v1/usuarios_empresas")return response(holding?[{empresa_id:"arcade_hub"}]:[]);
  if(url.pathname==="/rest/v1/acessos_empresas"){legacyRead=true;return response({id,senha:"fixture-legacy"});}
  if(url.pathname.startsWith("/rest/v1/rpc/"))return rpcFailure?response(rpcFailure,400):response(rpcData);
  throw new Error("Unexpected fixture path");
};
const reveal=(await import("../functions/acesso-senha/index.ts")).handler;
const manage=(await import("../functions/acessos-manage/index.ts")).handler;
const ops=(await import("../functions/dashboard-ops/index.ts")).handler;
function reset(){calls=[];holding=true;rpcFailure=null;rpcData={};legacyRead=false;Deno.env.delete("ACESSOS_LEGACY_COMPAT");}
const request=(body:Row={},token:string|null="user-token",method="POST")=>new Request("https://qa.invalid/functions",{method,headers:{...(token?{Authorization:"Bearer "+token}:{}),"Content-Type":"application/json"},...(method==="POST"?{body:JSON.stringify(body)}:{})});
const rpcs=()=>calls.filter(c=>c.path.startsWith("/rest/v1/rpc/"));

Deno.test("dashboard endpoints reject anonymous and invalid sessions before any RPC",async()=>{
  for(const handler of [reveal,manage,ops])for(const token of [null,"bad-token"]){reset();const r=await handler(request({},token));assert.equal(r.status,401);assert.equal(rpcs().length,0);}
});
Deno.test("dashboard methods and preflight do not access providers",async()=>{
  for(const handler of [reveal,manage,ops]){reset();assert.equal((await handler(request({},null,"GET"))).status,405);assert.equal((await handler(request({},null,"OPTIONS"))).status,200);assert.equal(calls.length,0);}
});
Deno.test("credential endpoints require holding before checking master or reading secrets",async()=>{
  reset();holding=false;const r=await reveal(request({id,mestra:master}));assert.equal(r.status,403);assert.equal(rpcs().length,0);assert.equal(legacyRead,false);
});
Deno.test("missing or incorrect master cannot invoke secret RPC",async()=>{
  for(const mestra of [undefined,"wrong-master"]){reset();const r=await reveal(request({id,mestra}));assert.ok([401,403].includes(r.status));assert.equal(rpcs().length,0);}
});
Deno.test("authorized credential reveal and copy identify the actor and audit action",async()=>{
  for(const action of ["revelar","copiar"]){reset();rpcData={senha:"fixture-private"};const r=await reveal(request({id,mestra:master,action}));assert.equal(r.status,200);assert.equal((await r.json()).senha,"fixture-private");assert.equal(rpcs()[0].body.p_actor,uid);assert.equal(rpcs()[0].body.p_action,action);assert.equal(legacyRead,false);}
});
Deno.test("master configuration is required and cannot fall back to a bundled hash",async()=>{
  const configured=Deno.env.get("ACESSOS_MASTER_HASH")!;
  try{
    for(const value of [null,"invalid-config"]){
      reset(); if(value===null)Deno.env.delete("ACESSOS_MASTER_HASH");else Deno.env.set("ACESSOS_MASTER_HASH",value);
      const r=await reveal(request({id,mestra:master}));assert.equal(r.status,503);assert.equal(rpcs().length,0);assert.equal(legacyRead,false);
    }
  }finally{Deno.env.set("ACESSOS_MASTER_HASH",configured);}
});
Deno.test("legacy read is disabled by default and is rollout-only for absent private RPC",async()=>{
  reset();rpcFailure={code:"PGRST202",message:"RPC absent"};assert.equal((await reveal(request({id,mestra:master}))).status,503);assert.equal(legacyRead,false);
  reset();Deno.env.set("ACESSOS_LEGACY_COMPAT","true");rpcFailure={code:"PGRST202",message:"RPC absent"};const r=await reveal(request({id,mestra:master}));assert.equal(r.status,200);assert.equal((await r.json()).senha,"fixture-legacy");assert.equal(legacyRead,true);
  reset();Deno.env.set("ACESSOS_LEGACY_COMPAT","true");rpcFailure={code:"42501",message:"holding_access_required"};assert.equal((await reveal(request({id,mestra:master}))).status,403);assert.equal(legacyRead,false);
});
Deno.test("metadata mutation returns metadata and never submits arbitrary fields",async()=>{
  reset();rpcData={access:{id,empresa_id:"clickdrop",usuario:"fixture"}};
  const r=await manage(request({action:"save",request_id:requestId,access:{empresa_id:"clickdrop",empresa_nome:"ClickDrop",usuario:"fixture",is_admin:true}}));
  assert.equal(r.status,200);assert.equal((await r.json()).access.id,id);assert.equal(rpcs()[0].body.p_payload.is_admin,undefined);assert.equal(rpcs()[0].body.p_payload.request_id,requestId);
});
Deno.test("changing deleting or clearing secret requires server master",async()=>{
  for(const body of [{action:"save",id,access:{senha:"replacement"}},{action:"delete",id},{action:"clear_secret",id}]){reset();assert.equal((await manage(request(body))).status,401);assert.equal(rpcs().length,0);}
});
Deno.test("metadata URL and IDs cannot inject an operation",async()=>{
  reset();assert.equal((await manage(request({action:"save",request_id:requestId,access:{empresa_id:"clickdrop",url:"javascript:fixture()"}}))).status,400);assert.equal(rpcs().length,0);
  assert.equal((await reveal(request({id:"not-a-uuid",mestra:master}))).status,400);
});
Deno.test("unknown database errors do not reveal provider content or credentials",async()=>{
  reset();rpcFailure={code:"XX000",message:"fixture-secret-that-must-not-leak"};const r=await manage(request({action:"events"}));assert.equal(r.status,503);assert.ok(!(await r.text()).includes("fixture-secret"));
});
Deno.test("lead mutation passes user identity and allowed reviewed fields only",async()=>{
  reset();rpcData={lead:{id,empresa_id:"clickdrop",nome:"Fixture"}};const r=await ops(request({action:"save_lead",request_id:requestId,lead:{empresa_id:"clickdrop",nome:"Fixture",responsavel:"Equipe",proxima_acao:"Ligar",proxima_acao_em:"2026-11-14T12:00:00Z",is_admin:true}}));
  assert.equal(r.status,200);assert.equal(rpcs()[0].body.p_actor,uid);assert.equal(rpcs()[0].body.p_payload.lead.is_admin,undefined);assert.equal(rpcs()[0].body.p_payload.lead.responsavel,"Equipe");
});
Deno.test("duplicate lead is a review conflict rather than automatic merge",async()=>{
  reset();rpcData={error:"duplicate_lead_review_required",conflict_ids:[id]};const r=await ops(request({action:"save_lead",request_id:requestId,lead:{empresa_id:"clickdrop",nome:"Duplicate"}}));assert.equal(r.status,409);assert.deepEqual((await r.json()).conflict_ids,[id]);
});
Deno.test("contact conversion carries explicit destination and stable request identity",async()=>{
  reset();const r=await ops(request({action:"convert_contact",contato_id:id,empresa_id:"clickdrop",request_id:requestId,lead:{nome:"Reviewed"}}));assert.equal(r.status,200);assert.equal(rpcs()[0].body.p_payload.contato_id,id);assert.equal(rpcs()[0].body.p_payload.empresa_id,"clickdrop");assert.equal(rpcs()[0].body.p_payload.request_id,requestId);
});
Deno.test("project and blocked-page RPC authorization errors remain forbidden",async()=>{
  for(const message of ["project_access_required","page_blocked"]){reset();rpcFailure={code:"42501",message};const r=await ops(request({action:"list_reimbursements",ano:2026}));assert.equal(r.status,403);}
});
Deno.test("reimbursement is a bookkeeping RPC with finite amount and idempotence key",async()=>{
  reset();const r=await ops(request({action:"record_reimbursement",request_id:requestId,payment:{socio:"SAROM",valor:10,data_pagamento:"2026-11-14",referencia:"Already paid"}}));assert.equal(r.status,200);assert.equal(rpcs()[0].body.p_action,"record");assert.equal(rpcs()[0].body.p_payload.request_id,requestId);assert.equal(calls.filter(c=>!c.path.startsWith("/auth/")&&!c.path.startsWith("/rest/")).length,0);
});
