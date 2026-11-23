import { RealtimeHub, filterCheck } from './realtime.js';
import { handleWisp } from './wisp.js';
import { bareRequest, bareWebSocket } from './bare.js';
import { basicProxy } from './proxy.js';
import { thumbResponse } from './thumb.js';

const SYS = 'You are Rel AI, a friendly, concise assistant inside a site called Rel Zone. Help with questions, homework, writing and brainstorming. Show your reasoning on math. Use plain text, no markdown tables.';
const FALLBACK_MODELS = ['openai/gpt-oss-20b','llama-3.3-70b-versatile','llama-3.1-8b-instant'];
const modelCache = new Map(), hits = new Map();
function limited(bucket,ip,limit,windowSec){const key=bucket+'|'+ip,now=Date.now();let q=hits.get(key)||[];q=q.filter(t=>now-t<=windowSec*1000);if(q.length>=limit){hits.set(key,q);return true;}q.push(now);hits.set(key,q);return false;}
function ipOf(req){return req.headers.get('CF-Connecting-IP')||'unknown';}
function json(obj,status=200){return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
async function groqCall(env,messages,stream,maxTokens,signal){
 if(!env.GROQ_API_KEY)return{error:{status:500,detail:'no_key'}};
 const url=env.GROQ_URL||'https://api.groq.com/openai/v1/chat/completions',primary=env.GROQ_MODEL||'openai/gpt-oss-120b',seen=new Set();let last;
 for(const model of [modelCache.get('working'),primary,...FALLBACK_MODELS]){if(!model||seen.has(model))continue;seen.add(model);const body={model,messages,stream,max_tokens:maxTokens};if(model.startsWith('openai/gpt-oss'))body.reasoning_effort='low';else body.temperature=.7;
  let r;try{r=await fetch(url,{method:'POST',signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.GROQ_API_KEY},body:JSON.stringify(body)});}catch(e){return{error:{status:502,detail:e.message}};}
  if(r.ok){modelCache.set('working',model);return{response:r,model};}const text=await r.text().catch(()=>''),detail=(()=>{try{return JSON.parse(text)?.error?.message||text.slice(0,200)}catch{return text.slice(0,200)}})();last={status:r.status,detail};const d=detail.toLowerCase();const missing=[400,404].includes(r.status)&&d.includes('model')&&['does not exist','decommission','no access','not have access','deprecated','not found'].some(w=>d.includes(w));if(!missing)break;
 }
 return{error:last||{status:502,detail:'No available Groq model.'}};
}
async function aiChat(request,env){const ip=ipOf(request);if(!env.GROQ_API_KEY)return json({error:'no_key'},500);if(limited('chat',ip,20,60))return json({error:'rate_limited'},429);
 let data;try{data=await request.json();}catch{return json({error:'bad_request'},400);}const msgs=[];for(const m of (Array.isArray(data.messages)?data.messages:[]).slice(-12)){if(m&&typeof m==='object'&&(m.role==='user'||m.role==='assistant')&&m.content)msgs.push({role:m.role,content:String(m.content).slice(0,4000)});}if(!msgs.length||msgs.at(-1).role!=='user')return json({error:'bad_request'},400);
 const out=await groqCall(env,[{role:'system',content:SYS},...msgs],true,2048,request.signal);if(!out.response){const e=out.error||{};return json({error:e.detail==='no_key'?'no_key':'upstream',status:e.status,detail:e.detail},[401,403,429].includes(e.status)?e.status:502);}return new Response(out.response.body,{status:200,headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'}});
}
async function aiHealth(request,env){const info={version:'9-virtualxp-cloudflare',key_loaded:!!env.GROQ_API_KEY,model:env.GROQ_MODEL||'openai/gpt-oss-120b'};if(!env.GROQ_API_KEY){info.problem='GROQ_API_KEY secret is not set.';return json(info);}if(limited('health',ipOf(request),10,60)){info.problem='Too many checks, wait a minute.';return json(info,429);}const out=await groqCall(env,[{role:'user',content:'hi'}],false,64,request.signal);if(out.response){await out.response.arrayBuffer();Object.assign(info,{groq_status:200,model_in_use:out.model,result:'OK, Groq accepted the key and the model. The AI should work.'});}else{info.groq_status=out.error?.status;info.problem=out.error?.detail;}return json(info);}

export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url),p=url.pathname;
  if(p==='/api/ice'&&request.method==='GET'){let servers;try{servers=env.ICE_SERVERS?JSON.parse(env.ICE_SERVERS):null;}catch{}if(!Array.isArray(servers))servers=[{urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']}];return json(servers);}
  if(p==='/api/health'&&request.method==='GET')return aiHealth(request,env);
  if(p==='/api/filter-test'&&request.method==='GET'){if(limited('ftest',ipOf(request),5,60))return json({problem:'Too many checks, wait a minute.'},429);return json(await filterCheck(env));}
  if(p==='/api/thumb'&&request.method==='GET')return thumbResponse(url,limited,ipOf(request));
  if(p==='/api/chat'&&request.method==='POST')return aiChat(request,env);
  if(p==='/proxy'&&['GET','POST'].includes(request.method)){if(limited('proxy',ipOf(request),300,60))return new Response('Too many requests. Wait a moment and try again.',{status:429});return basicProxy(request,url);}
  if(p==='/wisp'||p==='/wisp/')return handleWisp(request,env);
  if(p==='/bare/request')return bareRequest(request,env,limited,ipOf(request));
  if(p==='/bare/ws')return bareWebSocket(request,env,limited,ipOf(request));
  if(p==='/ws/chat'||p==='/ws/call'){if(request.headers.get('Upgrade')!=='websocket')return new Response('WebSocket upgrade required',{status:426});const name=p==='/ws/chat'?'chat':'calls';const id=env.REALTIME.idFromName(name);return env.REALTIME.get(id).fetch(request);}
  return env.ASSETS.fetch(request);
 }
};

export { RealtimeHub };
