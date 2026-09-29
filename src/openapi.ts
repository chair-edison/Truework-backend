export const openapi={
  openapi:'3.1.0',info:{title:'Truework API',version:'0.1.0',description:'All authenticated endpoints require a Supabase access token. JSON uses snake_case and UTC timestamps.'},
  servers:[{url:'/api/v1'}],
  components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',bearerFormat:'JWT'}},schemas:{
    Error:{type:'object',properties:{error:{type:'object',properties:{code:{type:'string'},message:{type:'string'},field_errors:{type:'array',items:{type:'object'}},retryable:{type:'boolean'},request_id:{type:'string',format:'uuid'}}}}},
    CheckCreate:{type:'object',required:['input_type'],properties:{input_type:{type:'string',enum:['SCREENSHOT','URL','TEXT']},content:{type:'string'},upload_id:{type:'string',format:'uuid'}}},
    Verification:{type:'object',properties:{status:{type:'string',enum:['OFFICIAL','VERIFIED_EMPLOYER','UNVERIFIED','WARNING']},summary:{type:'string'},disclaimer:{type:'string'},risk_indicators:{type:'array',items:{type:'object'}},evidence:{type:'array',items:{type:'object'}},checked_at:{type:'string',format:'date-time'}}}
  }},
  paths:{
    '/jobs':{get:{summary:'Search active jobs',parameters:['q','location','country','work_scope','occupation','work_type','source_type','verification_status','industry','sort','page','limit'].map(name=>({in:'query',name,schema:{type:name==='page'||name==='limit'?'integer':'string'}})),responses:{'200':{description:'Paginated job list'}}}},
    '/jobs/{id}':{get:{summary:'Get active job',responses:{'200':{description:'Job with source, company, saved flag'}}}},
    '/jobs/{id}/save':{post:{summary:'Save a job',security:[{bearerAuth:[]}],responses:{'200':{description:'Saved'}}},delete:{summary:'Unsave a job',security:[{bearerAuth:[]}],responses:{'200':{description:'Removed'}}}},
    '/users/me/saved-jobs':{get:{summary:'Get own saved jobs',security:[{bearerAuth:[]}],responses:{'200':{description:'Paginated saved jobs'}}}},
    '/users/me/preferences':{get:{summary:'Get own preferences',security:[{bearerAuth:[]}],responses:{'200':{description:'Preferences'}}},put:{summary:'Set own preferences',security:[{bearerAuth:[]}],responses:{'200':{description:'Preferences'}}}},
    '/uploads/job-checks':{post:{summary:'Upload a private JPEG, PNG, or WebP image as raw request body, maximum 4MB',security:[{bearerAuth:[]}],responses:{'201':{description:'Upload ID and expiry'}}}},
    '/job-checks':{post:{summary:'Create a check. Optional Idempotency-Key header.',security:[{bearerAuth:[]}],requestBody:{content:{'application/json':{schema:{$ref:'#/components/schemas/CheckCreate'}}}},responses:{'202':{description:'Check ID and polling interval'}}}},
    '/job-checks/{id}':{get:{summary:'Get own check status and result',security:[{bearerAuth:[]}],responses:{'200':{description:'Progress, failure, or completed report'}}}},
    '/job-checks/{id}/alternatives':{get:{summary:'Get active verified internal alternatives',security:[{bearerAuth:[]}],responses:{'200':{description:'Alternative jobs'}}}},
    '/openapi.json':{get:{summary:'OpenAPI specification',responses:{'200':{description:'Specification'}}}}
  }
} as const;
