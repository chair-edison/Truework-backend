import { Hono } from 'hono';
import { ApiError, config, db, type AppEnv } from './core.js';
import { jobs, users } from './jobs.js';
import { uploads, checks } from './checks.js';
import { openapi } from './openapi.js';

export const app=new Hono<AppEnv>();
app.use('*',async(c,next)=>{
  const requestId=crypto.randomUUID();c.set('requestId',requestId);c.header('X-Request-Id',requestId);
  const origin=c.req.header('origin');const allowed=(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(origin&&allowed.includes(origin)){c.header('Access-Control-Allow-Origin',origin);c.header('Vary','Origin');c.header('Access-Control-Allow-Headers','Authorization,Content-Type,Idempotency-Key');c.header('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');}
  if(c.req.method==='OPTIONS')return c.body(null,origin&&allowed.includes(origin)?204:403);
  await next();
});
app.use('*',async(c,next)=>{const start=Date.now();await next();console.info(JSON.stringify({event:'http',method:c.req.method,path:new URL(c.req.url).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi,':id'),status:c.res.status,duration_ms:Date.now()-start,request_id:c.get('requestId')}));});
app.onError((err,c)=>{
  const e=err instanceof ApiError?err:new ApiError(500,'INTERNAL_ERROR','요청을 처리하지 못했습니다.',true);
  if(!(err instanceof ApiError))console.error(JSON.stringify({event:'server_error',request_id:c.get('requestId'),type:err.name}));
  return c.json({error:{code:e.code,message:e.message,field_errors:e.fieldErrors||[],retryable:e.retryable,request_id:c.get('requestId')}},e.status as any);
});
app.notFound(c=>c.json({error:{code:'NOT_FOUND',message:'경로를 찾을 수 없습니다.',field_errors:[],retryable:false,request_id:c.get('requestId')}},404));
app.get('/health/live',c=>c.json({status:'ok'}));
app.get('/health/ready',async c=>{
  config();if(!process.env.OPENAI_API_KEY)throw new ApiError(503,'NOT_READY','서비스를 일시적으로 사용할 수 없습니다.',true);
  const result=await db().from('sources').select('id').limit(1);if(result.error)throw new ApiError(503,'NOT_READY','서비스를 일시적으로 사용할 수 없습니다.',true);
  return c.json({status:'ready'});
});
app.get('/api/v1/openapi.json',c=>c.json(openapi));
app.get('/api/internal/retention',async c=>{
  if(!process.env.CRON_SECRET||c.req.header('authorization')!==`Bearer ${process.env.CRON_SECRET}`)throw new ApiError(401,'AUTH_REQUIRED','인증이 필요합니다.');
  const client=db(),now=new Date().toISOString();
  const expired=await client.from('job_check_uploads').select('id,storage_key').lt('expires_at',now).limit(500);if(expired.error)throw new ApiError(503,'DATABASE_UNAVAILABLE','서비스를 일시적으로 사용할 수 없습니다.',true);
  if(expired.data?.length){const removed=await client.storage.from('job-checks').remove(expired.data.map(x=>x.storage_key));if(removed.error)throw new ApiError(503,'STORAGE_UNAVAILABLE','서비스를 일시적으로 사용할 수 없습니다.',true);const deleted=await client.from('job_check_uploads').delete().in('id',expired.data.map(x=>x.id));if(deleted.error)throw new ApiError(503,'DATABASE_UNAVAILABLE','서비스를 일시적으로 사용할 수 없습니다.',true);}
  const old=new Date(Date.now()-30*86400000).toISOString();const checks=await client.from('job_checks').delete().lt('created_at',old);if(checks.error)throw new ApiError(503,'DATABASE_UNAVAILABLE','서비스를 일시적으로 사용할 수 없습니다.',true);
  await client.from('api_rate_limits').delete().lt('window_start',new Date(Date.now()-86400000).toISOString());
  return c.json({status:'ok',uploads_deleted:expired.data?.length||0});
});
app.route('/api/v1/jobs',jobs);
app.route('/api/v1/users',users);
app.route('/api/v1/uploads',uploads);
app.route('/api/v1/job-checks',checks);
