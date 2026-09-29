import { Hono } from 'hono';
import sharp from 'sharp';
import { waitUntil } from '@vercel/functions';
import { createHash } from 'node:crypto';
import { ApiError, assertDb, invalid, rateLimit, requireAuth, uuid, type AppEnv } from './core.js';
import { assess, explain, extract, fetchOffer, registry } from './verify.js';

export const uploads=new Hono<AppEnv>(), checks=new Hono<AppEnv>();
uploads.use('/*',requireAuth);checks.use('/*',requireAuth);
uploads.post('/job-checks',async c=>{
  await rateLimit(c,'upload');
  const contentLength=Number(c.req.header('content-length')||0);
  if(contentLength>4*1024*1024)throw new ApiError(413,'FILE_TOO_LARGE','이미지는 4MB 이하여야 합니다.');
  const raw=await c.req.arrayBuffer();if(raw.byteLength>4*1024*1024)throw new ApiError(413,'FILE_TOO_LARGE','이미지는 4MB 이하여야 합니다.');
  if(raw.byteLength<12)throw invalid('file');
  const b=Buffer.from(raw);let mime:string|undefined;
  if(b.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])))mime='image/jpeg';
  else if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
  else if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')mime='image/webp';
  if(!mime)throw new ApiError(415,'UNSUPPORTED_IMAGE','JPEG, PNG, WebP 이미지만 지원합니다.');
  let clean:Buffer;
  try {const img=sharp(b,{limitInputPixels:25_000_000});const meta=await img.metadata();if(!meta.width||!meta.height)throw Error();clean=await img.rotate().jpeg({quality:85}).toBuffer();}catch{throw new ApiError(415,'INVALID_IMAGE','이미지 내용을 확인해 주세요.');}
  if(clean.length>4*1024*1024)throw new ApiError(413,'FILE_TOO_LARGE','이미지는 4MB 이하여야 합니다.');
  const id=crypto.randomUUID(),key=`${c.get('userId')}/${id}.jpg`,client=c.get('db');
  const stored=await client.storage.from('job-checks').upload(key,clean,{contentType:'image/jpeg',upsert:false});assertDb(stored.error);
  const expires_at=new Date(Date.now()+24*3600*1000).toISOString();
  const {error}=await client.from('job_check_uploads').insert({id,user_id:c.get('userId'),storage_key:key,mime_type:'image/jpeg',size_bytes:clean.length,expires_at});
  if(error){await client.storage.from('job-checks').remove([key]);assertDb(error);}
  return c.json({upload_id:id,expires_at},201);
});

checks.post('/',async c=>{
  await rateLimit(c,'check');
  const raw=await c.req.text();if(raw.length>21000)throw new ApiError(413,'BODY_TOO_LARGE','입력이 너무 깁니다.');
  let body:any;try{body=JSON.parse(raw);}catch{throw invalid('body');}
  const type=body?.input_type;
  if(!['SCREENSHOT','URL','TEXT'].includes(type))throw invalid('input_type');
  if(type==='SCREENSHOT'?(typeof body.upload_id!=='string'||body.content!=null):(typeof body.content!=='string'||body.upload_id!=null))throw invalid('content');
  if(type==='TEXT'&&(body.content.trim().length<20||body.content.length>20000))throw invalid('content');
  if(type==='URL'){try{const u=new URL(body.content);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error();}catch{throw invalid('content');}}
  const client=c.get('db'),userId=c.get('userId');let inputRef=body.content;
  const key=c.req.header('idempotency-key');if(key&&(!/^[A-Za-z0-9_-]{8,128}$/.test(key)))throw invalid('Idempotency-Key');
  const requestHash=createHash('sha256').update(JSON.stringify({type,content:body.content||null,upload_id:body.upload_id||null})).digest('hex');
  if(key){const previous=await client.from('job_checks').select('id,status,request_hash').eq('user_id',userId).eq('idempotency_key',key).maybeSingle();assertDb(previous.error);if(previous.data){if(previous.data.request_hash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','이미 사용된 요청 키입니다.');return c.json({check_id:previous.data.id,status:previous.data.status,poll_after_ms:2000},202);}}
  if(type==='SCREENSHOT'){
    const upload=await client.from('job_check_uploads').select('*').eq('id',uuid(body.upload_id)).eq('user_id',userId).maybeSingle();assertDb(upload.error);
    if(!upload.data||upload.data.consumed_by||new Date(upload.data.expires_at).getTime()<Date.now())throw new ApiError(409,'UPLOAD_UNAVAILABLE','업로드가 만료되었거나 이미 사용되었습니다.');
    inputRef=upload.data.storage_key;
  }
  const id=crypto.randomUUID();const insert=await client.from('job_checks').insert({id,user_id:userId,input_type:type,input_ref:inputRef,idempotency_key:key||null,request_hash:requestHash}).select('id,status').single();
  if(insert.error){if(key&&insert.error.code==='23505'){const p=await client.from('job_checks').select('id,status,request_hash').eq('user_id',userId).eq('idempotency_key',key).single();assertDb(p.error);if(p.data){if(p.data.request_hash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','이미 사용된 요청 키입니다.');return c.json({check_id:p.data.id,status:p.data.status,poll_after_ms:2000},202);}}assertDb(insert.error);}
  if(type==='SCREENSHOT'){const claim=await client.from('job_check_uploads').update({consumed_by:id}).eq('id',body.upload_id).is('consumed_by',null).select('id').maybeSingle();assertDb(claim.error);if(!claim.data){await client.from('job_checks').delete().eq('id',id);throw new ApiError(409,'UPLOAD_UNAVAILABLE','업로드가 이미 사용되었습니다.');}}
  const task=processCheck(client,id,userId,type,inputRef);
  if(process.env.VERCEL)waitUntil(task);else void task;
  return c.json({check_id:id,status:'QUEUED',poll_after_ms:2000},202);
});
async function processCheck(client:any,id:string,userId:string,type:string,ref:string){
  const update=async(status:string,extra:any={})=>{const r=await client.from('job_checks').update({status,updated_at:new Date().toISOString(),...extra}).eq('id',id).eq('user_id',userId);assertDb(r.error);};
  const audit=async(event:string,details:any={})=>{await client.from('check_audit').insert({job_check_id:id,event,details});};
  try{
    await update('EXTRACTING');await audit('EXTRACTING');
    let input:any={type};
    if(type==='TEXT')input.text=ref;
    if(type==='URL'){input.text=await fetchOffer(ref);}
    if(type==='SCREENSHOT'){const file=await client.storage.from('job-checks').download(ref);assertDb(file.error);input.image=new Uint8Array(await file.data.arrayBuffer());input.mime='image/jpeg';}
    const result=await extract(input);
    if(type==='URL')result.value.source_url=ref;
    await update('VERIFYING',{extracted_data:result.value,model_name:result.model,prompt_version:'1',schema_version:'1',llm_usage:result.usage});await audit('VERIFYING',{model:result.model,prompt_version:'1'});
    const reg=await registry(client,result.value);const decision=assess(result.value,reg);
    await update('EXPLAINING');await audit('DECISION',{status:decision.status,policy_version:decision.policy_version,risks:decision.risks.map(r=>r.risk_code)});
    const explanation=await explain(result.value,decision);
    const ev=await client.from('evidence').upsert(decision.evidence.map(e=>({...e,job_check_id:id})),{onConflict:'job_check_id,code'}).select('id,code');assertDb(ev.error);
    const ids=new Map(ev.data.map((e:any)=>[e.code,e.id]));
    const old=new Map(decision.evidence.map(e=>[e.id,e.code]));
    const riskRows=decision.risks.map(r=>({job_check_id:id,risk_code:r.risk_code,severity:r.severity,explanation:r.explanation,evidence_ids:r.evidence_ids.map(eid=>ids.get(old.get(eid)||'')).filter(Boolean)}));
    if(riskRows.length){const rr=await client.from('job_check_risks').upsert(riskRows,{onConflict:'job_check_id,risk_code'});assertDb(rr.error);}
    await update('COMPLETED',{verification_status:decision.status,verification_summary:decision.summary,explanation,disclaimer:decision.disclaimer,safety_guidance:decision.safety_guidance,policy_version:decision.policy_version,completed_at:new Date().toISOString()});await audit('COMPLETED');
  }catch(e){const code=e instanceof ApiError?e.code:'PROCESSING_FAILED';console.error(JSON.stringify({event:'check_failed',check_id:id,code}));await update('FAILED',{failure_code:code,completed_at:new Date().toISOString()}).catch(()=>{});await audit('FAILED',{code}).catch(()=>{});}
}
checks.get('/:id',async c=>{
  const id=uuid(c.req.param('id')),client=c.get('db');const row=await client.from('job_checks').select('id,input_type,status,extracted_data,verification_status,verification_summary,explanation,disclaimer,safety_guidance,failure_code,created_at,updated_at,completed_at,policy_version').eq('id',id).eq('user_id',c.get('userId')).maybeSingle();assertDb(row.error);
  if(!row.data)throw new ApiError(404,'NOT_FOUND','검사 결과를 찾을 수 없습니다.');
  if(row.data.status==='FAILED')return c.json({check_id:id,status:'FAILED',failure_code:row.data.failure_code,retryable:['EXTRACTION_FAILED','SOURCE_UNAVAILABLE','SOURCE_TIMEOUT','PROCESSING_FAILED'].includes(row.data.failure_code),updated_at:row.data.updated_at});
  if(row.data.status!=='COMPLETED')return c.json({check_id:id,status:row.data.status,updated_at:row.data.updated_at,poll_after_ms:2000});
  const [ev,risks]=await Promise.all([client.from('evidence').select('*').eq('job_check_id',id),client.from('job_check_risks').select('*').eq('job_check_id',id)]);assertDb(ev.error);assertDb(risks.error);
  return c.json({check_id:id,status:'COMPLETED',extraction:row.data.extracted_data,verification:{status:row.data.verification_status,summary:row.data.verification_summary,disclaimer:row.data.disclaimer,risk_indicators:risks.data?.map((r:any)=>({code:r.risk_code,severity:r.severity,explanation:r.explanation,evidence_ids:r.evidence_ids})),evidence:ev.data,checked_at:row.data.completed_at,policy_version:row.data.policy_version},explanation:row.data.explanation,safety_guidance:row.data.safety_guidance});
});
checks.get('/:id/alternatives',async c=>{
  const id=uuid(c.req.param('id')),client=c.get('db');const check=await client.from('job_checks').select('status,extracted_data').eq('id',id).eq('user_id',c.get('userId')).maybeSingle();assertDb(check.error);
  if(!check.data)throw new ApiError(404,'NOT_FOUND','검사 결과를 찾을 수 없습니다.');
  if(check.data.status!=='COMPLETED')throw new ApiError(409,'CHECK_NOT_COMPLETE','검사가 아직 완료되지 않았습니다.');
  const x=check.data.extracted_data;let query=client.from('jobs').select('*,sources(*),companies(*)').eq('active',true).in('verification_status',['OFFICIAL','VERIFIED_EMPLOYER']).limit(100);
  if(x.country&&/^[A-Z]{2}$/.test(x.country))query=query.eq('country',x.country);
  const {data,error}=await query;assertDb(error);
  const {safeJob}=await import('./core.js');
  const items=(data||[]).map(safeJob).filter((j:any)=>j.sources?.active&&(!j.closes_at||new Date(j.closes_at).getTime()>=Date.now())&&['OFFICIAL','VERIFIED_EMPLOYER'].includes(j.verification_status)&&j.source_url!==x.source_url).map((j:any)=>({job:j,score:(x.job_title&&j.title.toLowerCase().includes(x.job_title.toLowerCase())?2:0)+(x.location&&j.location.toLowerCase().includes(x.location.toLowerCase())?1:0)})).sort((a:any,b:any)=>b.score-a.score).slice(0,10).map((v:any)=>v.job);
  return c.json({items,criteria:{country:x.country,job_title:x.job_title,location:x.location}});
});
