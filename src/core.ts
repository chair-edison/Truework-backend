import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Context, Next } from 'hono';

export type AppEnv = { Variables: { requestId: string; userId: string; db: SupabaseClient } };
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryable = false, public fieldErrors?: {field:string;code:string;message:string}[]) { super(message); }
}
export const invalid = (field: string, message = '입력값을 확인해 주세요.') =>
  new ApiError(422, 'INVALID_INPUT', message, false, [{field,code:'INVALID',message}]);
export function config() {
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError(503,'NOT_READY','서비스를 일시적으로 사용할 수 없습니다.',true);
  return {url,key};
}
export function db() { const {url,key}=config(); return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}); }
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const token=c.req.header('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) throw new ApiError(401,'AUTH_REQUIRED','로그인이 필요합니다.');
  const client=db();
  const {data,error}=await client.auth.getUser(token);
  if(error || !data.user) throw new ApiError(401,'AUTH_REQUIRED','로그인이 필요합니다.');
  c.set('userId',data.user.id); c.set('db',client);
  await next();
}
export function assertDb(error: {message:string}|null) {
  if (error) { console.error(JSON.stringify({event:'db_error',category:'query'})); throw new ApiError(503,'DATABASE_UNAVAILABLE','서비스를 일시적으로 사용할 수 없습니다.',true); }
}
export function positiveInt(raw: string|undefined, fallback: number, max: number) {
  if(raw===undefined) return fallback;
  const n=Number(raw);
  if(!Number.isSafeInteger(n)||n<1||n>max) throw invalid('limit');
  return n;
}
export function uuid(raw:string) { if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) throw invalid('id'); return raw; }
export function hostOf(raw:string):string|null { try { const u=new URL(raw); if(u.protocol!=='https:'||u.username||u.password||u.port) return null; return u.hostname.toLowerCase().replace(/\.$/,''); } catch {return null;} }
export function matchesDomain(host:string|null, domain:string|null|undefined) {
  if(!host||!domain)return false; const d=domain.toLowerCase().replace(/\.$/,''); return host===d||host.endsWith('.'+d);
}
export function officialJob(job:any, source:any) {
  return !!(source?.active && source?.verification_level==='OFFICIAL' && matchesDomain(hostOf(job.source_url),source.official_domain) && new Date(job.last_verified_at).getTime()>=new Date(source.last_checked_at).getTime());
}
export function safeJob(job:any) {
  const source=job.sources; const status=job.verification_status==='OFFICIAL'&&!officialJob(job,source)?'UNVERIFIED':job.verification_status;
  return {...job,verification_status:status};
}
export async function rateLimit(c:Context<AppEnv>,scope:string) {
  const d=c.get('db'), id=c.get('userId');
  const minute=new Date(Math.floor(Date.now()/60000)*60000).toISOString();
  const {data,error}=await d.rpc('take_rate_limit',{p_identity:`${scope}:${id}`,p_window:minute,p_limit:Number(process.env.RATE_LIMIT_PER_MINUTE||30)});
  assertDb(error);
  if(!data){c.header('Retry-After','60');throw new ApiError(429,'RATE_LIMITED','잠시 후 다시 시도해 주세요.',true);}
}
