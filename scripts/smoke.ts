const base=(process.env.SMOKE_BASE_URL||'http://localhost:8787').replace(/\/$/,'');
async function get(path:string,token?:string){const r=await fetch(base+path,{headers:token?{authorization:`Bearer ${token}`}:{}});if(!r.ok)throw Error(`${path}: ${r.status}`);return r.json() as Promise<any>;}
const live=await get('/health/live');if(live.status!=='ok')throw Error('Liveness failed');
const jobs=await get('/api/v1/jobs?limit=5');if(!Array.isArray(jobs.items))throw Error('Jobs contract failed');
if(jobs.items.length){const detail=await get(`/api/v1/jobs/${jobs.items[0].id}`);if(detail.job.verification_status!==jobs.items[0].verification_status)throw Error('Job detail mismatch');}
const token=process.env.SMOKE_TOKEN;
if(token){await get('/api/v1/users/me/preferences',token);await get('/api/v1/users/me/saved-jobs',token);}
console.log(JSON.stringify({status:'ok',jobs:jobs.items.length,authenticated:!!token}));
