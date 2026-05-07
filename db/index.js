const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let Database = null;
const { Pool } = require('pg');
const client = (process.env.DB_CLIENT || (process.env.DATABASE_URL ? 'postgres' : 'sqlite')).toLowerCase();
let sqlite, pgPool;
function dbFile(){ return process.env.SQLITE_FILE || './data/choferlink.sqlite'; }
function getSqlite(){ if(!sqlite){ if(!Database) Database = require('better-sqlite3'); fs.mkdirSync(path.dirname(dbFile()),{recursive:true}); sqlite=new Database(dbFile()); sqlite.pragma('journal_mode = WAL'); sqlite.pragma('foreign_keys = ON'); } return sqlite; }
function getPg(){ if(!pgPool){ if(!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL'); const ssl = process.env.PGSSLMODE === 'disable' ? undefined : { rejectUnauthorized:false }; pgPool=new Pool({connectionString:process.env.DATABASE_URL,ssl}); } return pgPool; }
function sqliteBind(sql, params=[]){
  const out=[];
  const s=String(sql).replace(/\$([0-9]+)/g,(_,n)=>{
    const idx=Number(n)-1;
    if(idx<0 || idx>=params.length) throw new Error(`SQL espera $${n}, pero solo recibió ${params.length} parámetro(s).`);
    out.push(params[idx]);
    return '?';
  });
  return {sql:s, params:out.length?out:params};
}
async function query(sql,params=[]){
  if(client==='postgres') return (await getPg().query(sql,params)).rows;
  const bound=sqliteBind(sql,Array.isArray(params)?params:[params]);
  const stmt=getSqlite().prepare(bound.sql);
  const isRead=/^\s*(select|pragma|with)/i.test(bound.sql);
  const hasReturning=/\breturning\b/i.test(bound.sql);
  if(isRead || hasReturning) return stmt.all(...bound.params);
  const r=stmt.run(...bound.params);
  return [{id:r.lastInsertRowid,changes:r.changes}];
}
function hpw(password,salt=crypto.randomBytes(16).toString('hex')){return `${salt}:${crypto.scryptSync(String(password),salt,64).toString('hex')}`}
function vpw(password,stored){ if(!stored||!stored.includes(':')) return false; const [salt,hash]=stored.split(':'); const cand=hpw(password,salt).split(':')[1]; return crypto.timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(cand,'hex')); }
function makeToken(){return crypto.randomBytes(32).toString('hex')}
async function tableExists(table){ if(client==='postgres') return Boolean((await query('SELECT to_regclass($1) AS name',[table]))[0]?.name); return (await query('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=$1',[table])).length>0; }
async function ensureColumn(table,col,def){ if(client==='postgres'){ await query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${def}`); return; } const cols=await query(`PRAGMA table_info(${table})`); if(!cols.some(c=>c.name===col)) await query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); }
async function migrate(){
  if(client==='postgres'){
    await query(`CREATE TABLE IF NOT EXISTS profiles(id SERIAL PRIMARY KEY,tipo TEXT NOT NULL,nombre TEXT NOT NULL,rut TEXT,region TEXT,comuna TEXT,ubicacion TEXT NOT NULL,licencia TEXT,experiencia INTEGER DEFAULT 0,especialidad TEXT NOT NULL,disponibilidad TEXT NOT NULL,verificado BOOLEAN DEFAULT FALSE,email TEXT,whatsapp TEXT NOT NULL,rutas TEXT,descripcion TEXT,documento_licencia TEXT,hoja_vida_conductor TEXT,licencia_vencimiento TEXT,documento_estado TEXT DEFAULT 'pendiente',password_hash TEXT,email_verified BOOLEAN DEFAULT FALSE,email_verification_token_hash TEXT,email_verification_expires_at TIMESTAMPTZ,password_reset_token_hash TEXT,password_reset_expires_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS trucks(id SERIAL PRIMARY KEY,profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,patente TEXT NOT NULL,tipo TEXT NOT NULL,marca_modelo TEXT,anio INTEGER,capacidad_toneladas TEXT,seguro_vigente TEXT,revision_tecnica TEXT,permiso_circulacion TEXT,soap TEXT,disponibilidad TEXT,documento_vehiculo TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS companies(id SERIAL PRIMARY KEY,nombre TEXT NOT NULL,razon_social TEXT,rut_empresa TEXT,region TEXT,comuna TEXT,ubicacion TEXT NOT NULL,tipo_empresa TEXT NOT NULL,necesidad TEXT NOT NULL,email TEXT NOT NULL UNIQUE,whatsapp TEXT NOT NULL,password_hash TEXT NOT NULL,plan TEXT DEFAULT 'free',verificada BOOLEAN DEFAULT FALSE,rating REAL DEFAULT 4.2,tamano_empresa TEXT,sitio_web TEXT,descripcion TEXT,documento_empresa TEXT,email_verified BOOLEAN DEFAULT FALSE,email_verification_token_hash TEXT,email_verification_expires_at TIMESTAMPTZ,password_reset_token_hash TEXT,password_reset_expires_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS company_sessions(token TEXT PRIMARY KEY,company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS profile_sessions(token TEXT PRIMARY KEY,profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS jobs(id SERIAL PRIMARY KEY,company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,titulo TEXT NOT NULL,region TEXT,comuna TEXT,ubicacion TEXT NOT NULL,licencia TEXT NOT NULL,salario TEXT,descripcion TEXT NOT NULL,estado TEXT DEFAULT 'abierto',max_applications INTEGER DEFAULT 0,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS applications(id SERIAL PRIMARY KEY,job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,nombre TEXT NOT NULL,email TEXT,whatsapp TEXT NOT NULL,mensaje TEXT,status TEXT DEFAULT 'nuevo',created_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS application_status_history(id SERIAL PRIMARY KEY,application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,changed_by_type TEXT NOT NULL,changed_by_id INTEGER,status TEXT NOT NULL,message TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS saved_searches(id SERIAL PRIMARY KEY,company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,nombre TEXT NOT NULL,tipo TEXT,licencia TEXT,q TEXT,region TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS reviews(id SERIAL PRIMARY KEY,target_type TEXT NOT NULL,target_id INTEGER NOT NULL,from_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,reviewer_name TEXT,reviewer_type TEXT,rating INTEGER NOT NULL,criterio_1 INTEGER DEFAULT 0,criterio_2 INTEGER DEFAULT 0,criterio_3 INTEGER DEFAULT 0,comment TEXT,response TEXT,status TEXT DEFAULT 'publicada',application_id INTEGER,reviewer_profile_id INTEGER,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS events(id SERIAL PRIMARY KEY,type TEXT NOT NULL,company_id INTEGER,profile_id INTEGER,target_type TEXT,target_id INTEGER,metadata TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS favorites(id SERIAL PRIMARY KEY,company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(company_id,profile_id))`);
    await query(`CREATE TABLE IF NOT EXISTS contact_history(id SERIAL PRIMARY KEY,company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,channel TEXT DEFAULT 'whatsapp',created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(company_id,profile_id,channel))`);
    await query(`CREATE TABLE IF NOT EXISTS notifications(id SERIAL PRIMARY KEY,user_type TEXT NOT NULL,user_id INTEGER NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,read_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS payments(id SERIAL PRIMARY KEY,company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,provider TEXT NOT NULL DEFAULT 'flow',amount INTEGER NOT NULL,currency TEXT NOT NULL DEFAULT 'CLP',status TEXT NOT NULL DEFAULT 'pending',commerce_order TEXT UNIQUE,flow_token TEXT UNIQUE,flow_order TEXT,raw_response TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),paid_at TIMESTAMPTZ)`);
  } else {
    await query(`CREATE TABLE IF NOT EXISTS profiles(id INTEGER PRIMARY KEY AUTOINCREMENT,tipo TEXT NOT NULL,nombre TEXT NOT NULL,rut TEXT,region TEXT,comuna TEXT,ubicacion TEXT NOT NULL,licencia TEXT,experiencia INTEGER DEFAULT 0,especialidad TEXT NOT NULL,disponibilidad TEXT NOT NULL,verificado INTEGER DEFAULT 0,email TEXT,whatsapp TEXT NOT NULL,rutas TEXT,descripcion TEXT,documento_licencia TEXT,hoja_vida_conductor TEXT,licencia_vencimiento TEXT,documento_estado TEXT DEFAULT 'pendiente',password_hash TEXT,email_verified INTEGER DEFAULT 0,email_verification_token_hash TEXT,email_verification_expires_at TEXT,password_reset_token_hash TEXT,password_reset_expires_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await query(`CREATE TABLE IF NOT EXISTS trucks(id INTEGER PRIMARY KEY AUTOINCREMENT,profile_id INTEGER NOT NULL,patente TEXT NOT NULL,tipo TEXT NOT NULL,marca_modelo TEXT,anio INTEGER,capacidad_toneladas TEXT,seguro_vigente TEXT,revision_tecnica TEXT,permiso_circulacion TEXT,soap TEXT,disponibilidad TEXT,documento_vehiculo TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE)`);
    await query(`CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY AUTOINCREMENT,nombre TEXT NOT NULL,razon_social TEXT,rut_empresa TEXT,region TEXT,comuna TEXT,ubicacion TEXT NOT NULL,tipo_empresa TEXT NOT NULL,necesidad TEXT NOT NULL,email TEXT NOT NULL UNIQUE,whatsapp TEXT NOT NULL,password_hash TEXT NOT NULL,plan TEXT DEFAULT 'free',verificada INTEGER DEFAULT 0,rating REAL DEFAULT 4.2,tamano_empresa TEXT,sitio_web TEXT,descripcion TEXT,documento_empresa TEXT,email_verified INTEGER DEFAULT 0,email_verification_token_hash TEXT,email_verification_expires_at TEXT,password_reset_token_hash TEXT,password_reset_expires_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await query(`CREATE TABLE IF NOT EXISTS company_sessions(token TEXT PRIMARY KEY,company_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE)`);
    await query(`CREATE TABLE IF NOT EXISTS profile_sessions(token TEXT PRIMARY KEY,profile_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE)`);
    await query(`CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,titulo TEXT NOT NULL,region TEXT,comuna TEXT,ubicacion TEXT NOT NULL,licencia TEXT NOT NULL,salario TEXT,descripcion TEXT NOT NULL,estado TEXT DEFAULT 'abierto',max_applications INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE)`);
    await query(`CREATE TABLE IF NOT EXISTS applications(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id INTEGER NOT NULL,profile_id INTEGER,nombre TEXT NOT NULL,email TEXT,whatsapp TEXT NOT NULL,mensaje TEXT,status TEXT DEFAULT 'nuevo',created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE)`);
    await query(`CREATE TABLE IF NOT EXISTS application_status_history(id INTEGER PRIMARY KEY AUTOINCREMENT,application_id INTEGER NOT NULL,changed_by_type TEXT NOT NULL,changed_by_id INTEGER,status TEXT NOT NULL,message TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE CASCADE)`);
    await query(`CREATE TABLE IF NOT EXISTS saved_searches(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,nombre TEXT NOT NULL,tipo TEXT,licencia TEXT,q TEXT,region TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE)`);
    await query(`CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY AUTOINCREMENT,target_type TEXT NOT NULL,target_id INTEGER NOT NULL,from_company_id INTEGER,reviewer_name TEXT,reviewer_type TEXT,rating INTEGER NOT NULL,criterio_1 INTEGER DEFAULT 0,criterio_2 INTEGER DEFAULT 0,criterio_3 INTEGER DEFAULT 0,comment TEXT,response TEXT,status TEXT DEFAULT 'publicada',application_id INTEGER,reviewer_profile_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(from_company_id) REFERENCES companies(id) ON DELETE SET NULL)`);
    await query(`CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,company_id INTEGER,profile_id INTEGER,target_type TEXT,target_id INTEGER,metadata TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await query(`CREATE TABLE IF NOT EXISTS favorites(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,profile_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(company_id,profile_id),FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE)`);
    await query(`CREATE TABLE IF NOT EXISTS contact_history(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,profile_id INTEGER,channel TEXT DEFAULT 'whatsapp',created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(company_id,profile_id,channel),FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE SET NULL)`);
    await query(`CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_type TEXT NOT NULL,user_id INTEGER NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,read_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await query(`CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,provider TEXT NOT NULL DEFAULT 'flow',amount INTEGER NOT NULL,currency TEXT NOT NULL DEFAULT 'CLP',status TEXT NOT NULL DEFAULT 'pending',commerce_order TEXT UNIQUE,flow_token TEXT UNIQUE,flow_order TEXT,raw_response TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,paid_at TEXT,FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE)`);
  }
  await migrateExisting();
}
async function migrateExisting(){
  if(await tableExists('profiles')) for(const [c,d] of Object.entries({rut:'TEXT',region:'TEXT',comuna:'TEXT',rutas:'TEXT',descripcion:'TEXT',documento_estado:`TEXT DEFAULT 'pendiente'`,especialidad:`TEXT DEFAULT 'General'`,hoja_vida_conductor:'TEXT',licencia_vencimiento:'TEXT',password_hash:'TEXT',email_verified:(client==='postgres'?'BOOLEAN DEFAULT FALSE':'INTEGER DEFAULT 0'),email_verification_token_hash:'TEXT',email_verification_expires_at:(client==='postgres'?'TIMESTAMPTZ':'TEXT'),password_reset_token_hash:'TEXT',password_reset_expires_at:(client==='postgres'?'TIMESTAMPTZ':'TEXT')})) await ensureColumn('profiles',c,d);
  if(await tableExists('applications')){
    for(const [c,d] of Object.entries({profile_id:'INTEGER',status:"TEXT DEFAULT 'nuevo'"})) await ensureColumn('applications',c,d);
    await query('DELETE FROM applications WHERE profile_id IS NOT NULL AND id NOT IN (SELECT MIN(id) FROM applications WHERE profile_id IS NOT NULL GROUP BY job_id,profile_id)');
    await query('CREATE UNIQUE INDEX IF NOT EXISTS applications_unique_profile_job ON applications(job_id,profile_id) WHERE profile_id IS NOT NULL');
  }
  if(!(await tableExists('profile_sessions'))){
    if(client==='postgres') await query(`CREATE TABLE IF NOT EXISTS profile_sessions(token TEXT PRIMARY KEY,profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,created_at TIMESTAMPTZ DEFAULT NOW())`);
    else await query(`CREATE TABLE IF NOT EXISTS profile_sessions(token TEXT PRIMARY KEY,profile_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE)`);
  }
  if(await tableExists('trucks')) for(const [c,d] of Object.entries({revision_tecnica:'TEXT',permiso_circulacion:'TEXT',soap:'TEXT'})) await ensureColumn('trucks',c,d);
  if(await tableExists('companies')) for(const [c,d] of Object.entries({rut_empresa:'TEXT',razon_social:'TEXT',region:'TEXT',comuna:'TEXT',rating:'REAL DEFAULT 4.2',tamano_empresa:'TEXT',sitio_web:'TEXT',descripcion:'TEXT',documento_empresa:'TEXT',subscription_started_at:'TEXT',subscription_ends_at:'TEXT',cancel_at_period_end:'INTEGER DEFAULT 0',email_verified:(client==='postgres'?'BOOLEAN DEFAULT FALSE':'INTEGER DEFAULT 0'),email_verification_token_hash:'TEXT',email_verification_expires_at:(client==='postgres'?'TIMESTAMPTZ':'TEXT'),password_reset_token_hash:'TEXT',password_reset_expires_at:(client==='postgres'?'TIMESTAMPTZ':'TEXT')})) await ensureColumn('companies',c,d);
  if(await tableExists('companies')){ const now=iso(new Date()), end=iso(addDays(new Date(),30)); await query("UPDATE companies SET plan='paid',subscription_started_at=COALESCE(subscription_started_at,$1),subscription_ends_at=COALESCE(subscription_ends_at,$2),cancel_at_period_end=COALESCE(cancel_at_period_end,0) WHERE plan IN ('pro','premium')",[now,end]); await query("UPDATE companies SET plan='free' WHERE plan IS NULL OR plan NOT IN ('free','paid')"); const rows=await query("SELECT id,rut_empresa FROM companies WHERE rut_empresa IS NOT NULL AND rut_empresa<>''"); for(const row of rows){ try{ const normalized=normalizeCompanyRut(row.rut_empresa); if(normalized!==row.rut_empresa) await query('UPDATE companies SET rut_empresa=$1 WHERE id=$2',[normalized,row.id]); }catch(_){ /* no bloquear migración por datos antiguos inválidos */ } } }
  if(await tableExists('jobs')) for(const [c,d] of Object.entries({region:'TEXT',comuna:'TEXT',max_applications:'INTEGER DEFAULT 0'})) await ensureColumn('jobs',c,d);
  if(await tableExists('reviews')) for(const [c,d] of Object.entries({target_type:'TEXT',target_id:'INTEGER',from_company_id:'INTEGER',reviewer_name:'TEXT',reviewer_type:'TEXT',rating:'INTEGER DEFAULT 5',criterio_1:'INTEGER DEFAULT 0',criterio_2:'INTEGER DEFAULT 0',criterio_3:'INTEGER DEFAULT 0',comment:'TEXT',response:'TEXT',status:"TEXT DEFAULT 'publicada'",application_id:'INTEGER',reviewer_profile_id:'INTEGER'})) await ensureColumn('reviews',c,d);
  if(!(await tableExists('events'))){
    if(client==='postgres') await query(`CREATE TABLE IF NOT EXISTS events(id SERIAL PRIMARY KEY,type TEXT NOT NULL,company_id INTEGER,profile_id INTEGER,target_type TEXT,target_id INTEGER,metadata TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`);
    else await query(`CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,company_id INTEGER,profile_id INTEGER,target_type TEXT,target_id INTEGER,metadata TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  }
  if(!(await tableExists('favorites'))){
    if(client==='postgres') await query(`CREATE TABLE IF NOT EXISTS favorites(id SERIAL PRIMARY KEY,company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(company_id,profile_id))`);
    else await query(`CREATE TABLE IF NOT EXISTS favorites(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,profile_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(company_id,profile_id))`);
  }
  if(!(await tableExists('contact_history'))){
    if(client==='postgres') await query(`CREATE TABLE IF NOT EXISTS contact_history(id SERIAL PRIMARY KEY,company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,channel TEXT DEFAULT 'whatsapp',created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(company_id,profile_id,channel))`);
    else await query(`CREATE TABLE IF NOT EXISTS contact_history(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,profile_id INTEGER,channel TEXT DEFAULT 'whatsapp',created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(company_id,profile_id,channel))`);
  }
  if(!(await tableExists('application_status_history'))){
    if(client==='postgres') await query(`CREATE TABLE IF NOT EXISTS application_status_history(id SERIAL PRIMARY KEY,application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,changed_by_type TEXT NOT NULL,changed_by_id INTEGER,status TEXT NOT NULL,message TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`);
    else await query(`CREATE TABLE IF NOT EXISTS application_status_history(id INTEGER PRIMARY KEY AUTOINCREMENT,application_id INTEGER NOT NULL,changed_by_type TEXT NOT NULL,changed_by_id INTEGER,status TEXT NOT NULL,message TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE CASCADE)`);
  }
  if(!(await tableExists('notifications'))){
    if(client==='postgres') await query(`CREATE TABLE IF NOT EXISTS notifications(id SERIAL PRIMARY KEY,user_type TEXT NOT NULL,user_id INTEGER NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,read_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW())`);
    else await query(`CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_type TEXT NOT NULL,user_id INTEGER NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,read_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  }

  if(!(await tableExists('payments'))){
    if(client==='postgres') await query(`CREATE TABLE IF NOT EXISTS payments(id SERIAL PRIMARY KEY,company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,provider TEXT NOT NULL DEFAULT 'flow',amount INTEGER NOT NULL,currency TEXT NOT NULL DEFAULT 'CLP',status TEXT NOT NULL DEFAULT 'pending',commerce_order TEXT UNIQUE,flow_token TEXT UNIQUE,flow_order TEXT,raw_response TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),paid_at TIMESTAMPTZ)`);
    else await query(`CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,provider TEXT NOT NULL DEFAULT 'flow',amount INTEGER NOT NULL,currency TEXT NOT NULL DEFAULT 'CLP',status TEXT NOT NULL DEFAULT 'pending',commerce_order TEXT UNIQUE,flow_token TEXT UNIQUE,flow_order TEXT,raw_response TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,paid_at TEXT,FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE)`);
  }
  await ensureIndexes();
}
async function ensureIndexes(){
  const stmts = [
    'CREATE INDEX IF NOT EXISTS idx_profiles_tipo ON profiles(tipo)',
    'CREATE INDEX IF NOT EXISTS idx_profiles_region ON profiles(region)',
    'CREATE INDEX IF NOT EXISTS idx_profiles_comuna ON profiles(comuna)',
    'CREATE INDEX IF NOT EXISTS idx_profiles_licencia ON profiles(licencia)',
    'CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email)',
    'CREATE INDEX IF NOT EXISTS idx_trucks_profile_id ON trucks(profile_id)',
    'CREATE INDEX IF NOT EXISTS idx_companies_email ON companies(email)',
    'CREATE INDEX IF NOT EXISTS idx_jobs_company_id ON jobs(company_id)',
    'CREATE INDEX IF NOT EXISTS idx_jobs_region ON jobs(region)',
    'CREATE INDEX IF NOT EXISTS idx_jobs_licencia ON jobs(licencia)',
    'CREATE INDEX IF NOT EXISTS idx_jobs_estado_max ON jobs(estado,max_applications)',
    'CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications(job_id)',
    'CREATE INDEX IF NOT EXISTS idx_applications_profile_id ON applications(profile_id)',
    'CREATE INDEX IF NOT EXISTS idx_application_history_app ON application_status_history(application_id)',
    'CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews(target_type,target_id)',
    'CREATE INDEX IF NOT EXISTS idx_events_company_type ON events(company_id,type)',
    'CREATE INDEX IF NOT EXISTS idx_events_type_created ON events(type,created_at)',
    'CREATE INDEX IF NOT EXISTS idx_events_profile_type ON events(profile_id,type)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_type,user_id,read_at)',
    'CREATE INDEX IF NOT EXISTS idx_favorites_company ON favorites(company_id)',
    'CREATE INDEX IF NOT EXISTS idx_contact_company ON contact_history(company_id)',
    'CREATE INDEX IF NOT EXISTS idx_payments_company ON payments(company_id,status)',
    'CREATE INDEX IF NOT EXISTS idx_payments_token ON payments(flow_token)',
    client==='postgres' ? "CREATE UNIQUE INDEX IF NOT EXISTS companies_unique_rut_empresa ON companies(rut_empresa) WHERE rut_empresa IS NOT NULL AND rut_empresa<>''" : "CREATE UNIQUE INDEX IF NOT EXISTS companies_unique_rut_empresa ON companies(rut_empresa) WHERE rut_empresa IS NOT NULL AND rut_empresa<>''"
  ];
  for(const stmt of stmts){ try{ await query(stmt); }catch(e){} }
}
function loc(o){return o.ubicacion||[o.comuna,o.region].filter(Boolean).join(', ')}
function addDays(d,days){ const x=new Date(d); x.setDate(x.getDate()+days); return x; }
function iso(d){ return new Date(d).toISOString(); }
function cleanRut(value){ return String(value||'').replace(/\./g,'').replace(/-/g,'').replace(/\s+/g,'').toUpperCase(); }
function formatRut(value){ const v=cleanRut(value); if(!v) return ''; return `${v.slice(0,-1)}-${v.slice(-1)}`; }
function isValidRut(value){
  const rut=cleanRut(value);
  if(!/^\d{7,8}[0-9K]$/.test(rut)) return false;
  const body=rut.slice(0,-1), dv=rut.slice(-1);
  if(/^(\d)\1+$/.test(body)) return false;
  let sum=0,m=2;
  for(let i=body.length-1;i>=0;i--){ sum += Number(body[i])*m; m = m===7 ? 2 : m+1; }
  const calc=11-(sum%11);
  const expected=calc===11?'0':calc===10?'K':String(calc);
  return dv===expected;
}
function normalizeCompanyRut(value){
  const rut=formatRut(value);
  if(!rut) return '';
  if(!isValidRut(rut)) throw new Error('RUT empresa inválido. Revisa el número y el dígito verificador.');
  return rut;
}
const BUSINESS_RULES={
  plans:{free:{label:'Free',price:'$0 CLP',period_days:0},paid:{label:'Pagado',price:'0,5 UF/mes',period_days:30,renewal:'automatic_30_days',cancel_policy:'cancel_anytime_keep_until_period_end'}},
  application_statuses:{nuevo:'Postulación recibida, sin gestión.',contactado:'Empresa ya contactó al trabajador.',entrevista:'Proceso en entrevista.',contratado:'Trabajador contratado.',descartado:'Empresa descartó la postulación.',cerrado:'Proceso cerrado sin nueva gestión.',retirada:'Trabajador retiró la postulación.'},
  reviewable_statuses:['contactado','entrevista','contratado'],
  company_can:{publish_jobs:'verified_company',unlock_sensitive_data:'verified_company_and_paid_plan',contact_profiles:'verified_company_and_paid_plan',save_favorites:'verified_company_and_paid_plan',save_searches:'paid_plan',advance_application_status:'verified_company_and_paid_plan_for_contact_flow',decline_or_close_applications:'verified_company',review_profiles:'verified_company_and_paid_plan_with_reviewable_application'},
  profile_visibility:{anonymous_or_free:'masked_name_region_only_no_rut_email_phone_patent_or_exact_comuna',paid_verified:'full_profile_contact_data_and_vehicle_data'},
  free_limits:{profile_search_limit:20,active_open_jobs_limit:1,ranking:'disabled_for_profile_search',matches:'disabled',advanced_filters:'limited'},
  profile_can:{apply_to_open_compatible_jobs:'authenticated_profile',withdraw_application:'until_not_contratado_or_cerrado',review_companies:'reviewable_application'}
};
function planActive(c){ return Boolean(c && c.plan==='paid' && c.subscription_ends_at && new Date(c.subscription_ends_at).getTime()>Date.now()); }
function isVerifiedCompany(c){ return Boolean(c && c.verificada); }
function canCompanyUsePaidFeatures(c){ return Boolean(c && isVerifiedCompany(c) && planActive(c)); }
function canCompanyPublishJobs(c){ return isVerifiedCompany(c); }
function freeOpenJobsLimit(){ return Number(process.env.FREE_ACTIVE_JOBS_LIMIT || 1); }
function canCompanyUnlockContacts(c){ return canCompanyUsePaidFeatures(c); }
function canCompanySaveSearches(c){ return Boolean(c && planActive(c)); }
function canCompanyMoveApplicationTo(status,c){ const s=String(status||'').toLowerCase(); if(['nuevo','descartado','cerrado'].includes(s)) return isVerifiedCompany(c); if(['contactado','entrevista','contratado'].includes(s)) return canCompanyUsePaidFeatures(c); return false; }
function businessPermissions(company){ return {can_publish_jobs:canCompanyPublishJobs(company),can_unlock_contacts:canCompanyUnlockContacts(company),can_contact_profiles:canCompanyUnlockContacts(company),can_save_favorites:canCompanyUnlockContacts(company),can_save_searches:canCompanySaveSearches(company),can_decline_or_close_applications:isVerifiedCompany(company),can_advance_contact_flow:canCompanyUsePaidFeatures(company),free_active_jobs_limit:freeOpenJobsLimit(),requires_verification:!isVerifiedCompany(company),requires_paid_plan:!planActive(company)}; }
function companyPublic(c){
  if(!c) return null;
  const active=planActive(c);
  const base={...c,plan:active?'paid':'free',plan_label:active?'Pagado':'Free',plan_price:'0,5 UF/mes',billing_period_days:30,subscription_active:active,cancel_at_period_end:Boolean(c.cancel_at_period_end),verificada:Boolean(c.verificada),email_verified:Boolean(c.email_verified),rating:Number(c.rating||0),reviews_count:Number(c.reviews_count||0)};
  return {...base,permissions:businessPermissions(base)};
}

function emailTokenHash(token){ return crypto.createHash('sha256').update(String(token||'')).digest('hex'); }
async function createEmailVerification(userType,userId){
  const type=String(userType||'').toLowerCase();
  if(!['company','profile'].includes(type)) throw new Error('Tipo de verificación inválido.');
  const table=type==='company'?'companies':'profiles';
  const id=Number(userId);
  const token=makeToken();
  const hash=emailTokenHash(token);
  const expires=iso(addDays(new Date(),1));
  await query(`UPDATE ${table} SET email_verified=$1,email_verification_token_hash=$2,email_verification_expires_at=$3 WHERE id=$4`,[client==='postgres'?false:0,hash,expires,id]);
  const row=(await query(`SELECT id,email,nombre FROM ${table} WHERE id=$1`,[id]))[0];
  return row?{token,user_type:type,user_id:id,email:row.email,nombre:row.nombre,expires_at:expires}:null;
}
async function verifyEmailToken(token){
  const hash=emailTokenHash(token);
  for(const [type,table] of [['company','companies'],['profile','profiles']]){
    const row=(await query(`SELECT id,email,nombre,email_verification_expires_at FROM ${table} WHERE email_verification_token_hash=$1`,[hash]))[0];
    if(!row) continue;
    if(row.email_verification_expires_at && new Date(row.email_verification_expires_at).getTime()<Date.now()) throw new Error('El enlace de verificación expiró. Solicita uno nuevo.');
    await query(`UPDATE ${table} SET email_verified=$1,email_verification_token_hash=NULL,email_verification_expires_at=NULL WHERE id=$2`,[client==='postgres'?true:1,row.id]);
    return {ok:true,user_type:type,user_id:row.id,email:row.email,nombre:row.nombre};
  }
  throw new Error('Token de verificación inválido.');
}
async function getEmailVerificationTarget(userType,email){
  const type=String(userType||'').toLowerCase();
  if(!['company','profile'].includes(type)) throw new Error('Tipo inválido.');
  const table=type==='company'?'companies':'profiles';
  return (await query(`SELECT id,email,nombre,email_verified FROM ${table} WHERE LOWER(email)=LOWER($1)`,[String(email||'')]))[0]||null;
}

async function createTruck(profileId,t){ const r=await query(`INSERT INTO trucks(profile_id,patente,tipo,marca_modelo,anio,capacidad_toneladas,seguro_vigente,revision_tecnica,permiso_circulacion,soap,disponibilidad,documento_vehiculo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,[profileId,String(t.patente||'').toUpperCase(),t.tipo,t.marca_modelo||'',t.anio?Number(t.anio):null,t.capacidad_toneladas||'',t.seguro_vigente||'',t.revision_tecnica||'',t.permiso_circulacion||'',t.soap||'',t.disponibilidad||'',t.documento_vehiculo||'']); return (await query('SELECT * FROM trucks WHERE id=$1',[r[0].id]))[0]; }
async function createProfile(p){ const r=await query(`INSERT INTO profiles(tipo,nombre,rut,region,comuna,ubicacion,licencia,experiencia,especialidad,disponibilidad,verificado,email,whatsapp,rutas,descripcion,documento_licencia,hoja_vida_conductor,licencia_vencimiento,documento_estado,password_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,[p.tipo,p.nombre,p.rut||'',p.region||'',p.comuna||'',loc(p),p.licencia||'',Number(p.experiencia||0),p.especialidad,p.disponibilidad,client==='postgres'?Boolean(p.verificado):(p.verificado?1:0),String(p.email||'').toLowerCase(),p.whatsapp,p.rutas||'',p.descripcion||'',p.documento_licencia||'',p.hoja_vida_conductor||'',p.licencia_vencimiento||'',p.documento_estado||'pendiente',hpw(p.password)]); const id=r[0].id; for(const t of (p.trucks||[]).filter(t=>t.patente&&t.tipo)) await createTruck(id,t); const profile=(await query('SELECT * FROM profiles WHERE id=$1',[id]))[0]; const token=makeToken(); await query('INSERT INTO profile_sessions(token,profile_id) VALUES($1,$2)',[token,id]); const {password_hash,...clean}=profile; return {token,profile:clean}; }
async function createCompany(c){ const verifiedDefault = client==='postgres' ? false : 0; const r=await query(`INSERT INTO companies(nombre,razon_social,rut_empresa,region,comuna,ubicacion,tipo_empresa,necesidad,email,whatsapp,password_hash,plan,verificada,rating,tamano_empresa,sitio_web,descripcion,documento_empresa) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,[c.nombre,c.razon_social||'',normalizeCompanyRut(c.rut_empresa),c.region||'',c.comuna||'',loc(c),c.tipo_empresa,c.necesidad,String(c.email).toLowerCase(),c.whatsapp,hpw(c.password),'free',verifiedDefault,c.rating||4.2,c.tamano_empresa||'',c.sitio_web||'',c.descripcion||'',c.documento_empresa||'']); return companyPublic((await query('SELECT id,nombre,razon_social,rut_empresa,region,comuna,ubicacion,tipo_empresa,necesidad,email,whatsapp,plan,subscription_started_at,subscription_ends_at,cancel_at_period_end,verificada,rating,tamano_empresa,sitio_web,descripcion,documento_empresa,email_verified FROM companies WHERE id=$1',[r[0].id]))[0]); }
function todayViews(id){ const seed=(Number(id||0)*17)+new Date().getDate()*3; return (seed%9)+2; }
function verifiedCompanyAccess(company){ return canCompanyUnlockContacts(company); }
function maskedName(name){
  const parts=String(name||'Perfil').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return 'Perfil protegido';
  const first=parts[0];
  const initial=parts[1] ? ` ${parts[1][0].toUpperCase()}.` : '';
  return `${first}${initial}`;
}
function visibleProfile(p,company){
  const o={...p,views_today:todayViews(p.id),verificado:Boolean(p.verificado),reputation_rating:Number(p.reputation_rating||0),reviews_count:Number(p.reviews_count||0),score_1:Number(p.score_1||0),score_2:Number(p.score_2||0),score_3:Number(p.score_3||0)};
  const unlocked=verifiedCompanyAccess(company);
  if(!unlocked){
    const reason=company&&!company.verificada?'verification_required':'paid_plan_required';
    o.nombre=maskedName(o.nombre);
    o.comuna='Protegida';
    o.descripcion=o.descripcion?String(o.descripcion).slice(0,120)+'…':'';
    o.rutas='Protegidas';
    delete o.rut; delete o.email; delete o.whatsapp;
    o.contact_locked=true; o.contact_lock_reason=reason;
    o.trucks=(o.trucks||[]).map(t=>({tipo:t.tipo,patente:'Protegida',marca_modelo:'Protegido',capacidad_toneladas:t.capacidad_toneladas||'',revision_tecnica:'Protegida',permiso_circulacion:'Protegido',soap:'Protegido'}));
  } else o.contact_locked=false;
  return o;
}
async function listProfiles(f={},company=null){
  const where=[],params=[];
  if(f.q){params.push(`%${String(f.q).toLowerCase()}%`);where.push(`(LOWER(p.nombre) LIKE $${params.length} OR LOWER(p.region) LIKE $${params.length} OR LOWER(p.comuna) LIKE $${params.length} OR LOWER(p.especialidad) LIKE $${params.length} OR LOWER(p.rut) LIKE $${params.length})`)}
  if(f.tipo&&f.tipo!=='todos'){params.push(f.tipo);where.push(`p.tipo=$${params.length}`)}
  if(f.licencia&&f.licencia!=='todos'){params.push(f.licencia);where.push(`p.licencia=$${params.length}`)}
  if(f.region){params.push(f.region);where.push(`p.region=$${params.length}`)}
  const whereSql=where.length?'WHERE '+where.join(' AND '):'';
  const requestedLimit=Math.min(Math.max(parseInt(f.limit,10)||5,1),50);
  const paidUnlocked=verifiedCompanyAccess(company);
  const limit=paidUnlocked?requestedLimit:Math.min(requestedLimit,20);
  const page=Math.max(parseInt(f.page,10)||1,1);
  const offset=(page-1)*limit;
  const totalRow=(await query(`SELECT COUNT(*) total FROM profiles p ${whereSql}`,params))[0]||{total:0};
  const orderSql = paidUnlocked ? 'p.verificado DESC,reputation_rating DESC,p.id DESC' : 'p.verificado DESC,p.id DESC';
  const rows=await query(`SELECT p.*,COALESCE(AVG(r.rating),0) reputation_rating,COUNT(r.id) reviews_count,COALESCE(AVG(r.criterio_1),0) score_1,COALESCE(AVG(r.criterio_2),0) score_2,COALESCE(AVG(r.criterio_3),0) score_3 FROM profiles p LEFT JOIN reviews r ON r.target_type='profile' AND r.target_id=p.id ${whereSql} GROUP BY p.id ORDER BY ${orderSql} LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,limit,offset]);
  const ids=rows.map(r=>Number(r.id));
  const trucks=ids.length?await query(`SELECT * FROM trucks WHERE profile_id IN (${ids.map((_,i)=>`$${i+1}`).join(',')}) ORDER BY id`,ids):[];
  return {profiles:rows.map(p=>visibleProfile({...p,trucks:trucks.filter(t=>Number(t.profile_id)===Number(p.id))},company)),total:Number(totalRow.total||0),page,limit,pages:Math.max(1,Math.ceil(Number(totalRow.total||0)/limit))};
}
async function listCompanies(f={}){ const where=[],params=[]; if(f.q){params.push(`%${String(f.q).toLowerCase()}%`);where.push(`(LOWER(c.nombre) LIKE $${params.length} OR LOWER(c.region) LIKE $${params.length} OR LOWER(c.comuna) LIKE $${params.length} OR LOWER(c.tipo_empresa) LIKE $${params.length} OR LOWER(c.rut_empresa) LIKE $${params.length})`)} const rows=await query(`SELECT c.id,c.nombre,c.razon_social,c.rut_empresa,c.region,c.comuna,c.ubicacion,c.tipo_empresa,c.necesidad,c.plan,c.verificada,COALESCE(AVG(r.rating),c.rating,0) rating,COUNT(r.id) reviews_count,c.tamano_empresa,c.sitio_web,c.descripcion FROM companies c LEFT JOIN reviews r ON r.target_type='company' AND r.target_id=c.id ${where.length?'WHERE '+where.join(' AND '):''} GROUP BY c.id ORDER BY rating DESC,c.id DESC`,params); return rows.map(companyPublic); }
async function refreshCompanySubscription(id){
  let c=(await query('SELECT * FROM companies WHERE id=$1',[id]))[0];
  if(!c) return null;
  if(c.plan==='paid' && c.subscription_ends_at){
    let end=new Date(c.subscription_ends_at);
    const now=new Date();
    if(end<=now){
      if(Number(c.cancel_at_period_end)){
        await query("UPDATE companies SET plan='free',cancel_at_period_end=0 WHERE id=$1",[id]);
      }else{
        while(end<=now) end=addDays(end,30);
        await query('UPDATE companies SET subscription_ends_at=$1 WHERE id=$2',[iso(end),id]);
      }
      c=(await query('SELECT * FROM companies WHERE id=$1',[id]))[0];
    }
  }
  return c;
}
async function getCompanyByToken(t){ if(!t)return null; const r=await query('SELECT c.* FROM company_sessions s JOIN companies c ON c.id=s.company_id WHERE s.token=$1',[t]); if(!r[0]) return null; return companyPublic(await refreshCompanySubscription(r[0].id)); }
async function loginCompany(email,password){ let c=(await query('SELECT * FROM companies WHERE LOWER(email)=LOWER($1)',[email]))[0]; if(!c||!vpw(password,c.password_hash)) return null; if(!c.email_verified){ const err=new Error('Debes verificar tu email antes de iniciar sesión. Revisa tu correo o solicita un nuevo enlace.'); err.code='EMAIL_NOT_VERIFIED'; throw err; } c=await refreshCompanySubscription(c.id); const tk=makeToken(); await query('INSERT INTO company_sessions(token,company_id) VALUES($1,$2)',[tk,c.id]); const {password_hash,...clean}=c; return {token:tk,company:companyPublic(clean)}; }
async function getProfileByToken(t){ if(!t)return null; const r=await query('SELECT p.* FROM profile_sessions s JOIN profiles p ON p.id=s.profile_id WHERE s.token=$1',[t]); const p=r[0]; if(!p) return null; const {password_hash,...clean}=p; return {...clean,verificado:Boolean(clean.verificado)}; }
async function loginProfile(email,password){ const p=(await query('SELECT * FROM profiles WHERE LOWER(email)=LOWER($1)',[email]))[0]; if(!p||!vpw(password,p.password_hash)) return null; if(!p.email_verified){ const err=new Error('Debes verificar tu email antes de iniciar sesión. Revisa tu correo o solicita un nuevo enlace.'); err.code='EMAIL_NOT_VERIFIED'; throw err; } const tk=makeToken(); await query('INSERT INTO profile_sessions(token,profile_id) VALUES($1,$2)',[tk,p.id]); const {password_hash,...clean}=p; return {token:tk,profile:{...clean,verificado:Boolean(clean.verificado)}}; }

async function getProfileDashboard(profileId){
  const p=(await query('SELECT * FROM profiles WHERE id=$1',[profileId]))[0];
  if(!p) return null;
  const trucks=await query('SELECT * FROM trucks WHERE profile_id=$1 ORDER BY id',[profileId]);
  const applications=await listApplicationsForProfile(profileId);
  const notifications=await listNotifications('profile',profileId);
  const {password_hash,...clean}=p;
  return {profile:{...clean,verificado:Boolean(clean.verificado),trucks},applications,notifications};
}
async function updateProfile(profileId,data){
  const allowed={
    nombre:data.nombre, rut:data.rut, region:data.region||'', comuna:data.comuna||'', ubicacion:loc(data), licencia:data.licencia||'',
    experiencia:Number(data.experiencia||0), especialidad:data.especialidad, disponibilidad:data.disponibilidad, whatsapp:data.whatsapp,
    rutas:data.rutas||'', descripcion:data.descripcion||'', licencia_vencimiento:data.licencia_vencimiento||''
  };
  await query(`UPDATE profiles SET nombre=$1,rut=$2,region=$3,comuna=$4,ubicacion=$5,licencia=$6,experiencia=$7,especialidad=$8,disponibilidad=$9,whatsapp=$10,rutas=$11,descripcion=$12,licencia_vencimiento=$13 WHERE id=$14`,[allowed.nombre,allowed.rut||'',allowed.region,allowed.comuna,allowed.ubicacion,allowed.licencia,allowed.experiencia,allowed.especialidad,allowed.disponibilidad,allowed.whatsapp,allowed.rutas,allowed.descripcion,allowed.licencia_vencimiento,profileId]);
  const current=(await query('SELECT tipo FROM profiles WHERE id=$1',[profileId]))[0];
  if(current?.tipo==='Dueño de camión' && Array.isArray(data.trucks)){
    await query('DELETE FROM trucks WHERE profile_id=$1',[profileId]);
    for(const t of data.trucks.filter(t=>t && t.patente && t.tipo)) await createTruck(profileId,t);
  }
  return getProfileDashboard(profileId);
}
async function updateProfileAvailability(profileId,disponibilidad){
  await query('UPDATE profiles SET disponibilidad=$1 WHERE id=$2',[disponibilidad,profileId]);
  return getProfileDashboard(profileId);
}
async function changeProfilePassword(profileId,currentPassword,newPassword){
  const p=(await query('SELECT password_hash FROM profiles WHERE id=$1',[profileId]))[0];
  if(!p || !vpw(currentPassword,p.password_hash)) throw new Error('La contraseña actual no coincide.');
  await query('UPDATE profiles SET password_hash=$1 WHERE id=$2',[hpw(newPassword),profileId]);
  await query('DELETE FROM profile_sessions WHERE profile_id=$1',[profileId]);
  return {ok:true};
}
async function deleteProfileAccount(profileId){
  await query('DELETE FROM profile_sessions WHERE profile_id=$1',[profileId]);
  await query('UPDATE applications SET profile_id=NULL WHERE profile_id=$1',[profileId]);
  await query('DELETE FROM favorites WHERE profile_id=$1',[profileId]);
  await query('DELETE FROM contact_history WHERE profile_id=$1',[profileId]);
  await query('DELETE FROM reviews WHERE reviewer_profile_id=$1',[profileId]);
  await query('DELETE FROM profiles WHERE id=$1',[profileId]);
  return {ok:true};
}



async function createPaymentAttempt(companyId,p={}){
  const amount=Number(p.amount||0);
  if(!amount || amount<1) throw new Error('Monto de pago inválido.');
  const raw=JSON.stringify(p.raw_response||{}).slice(0,5000);
  const r=await query(`INSERT INTO payments(company_id,provider,amount,currency,status,commerce_order,flow_token,flow_order,raw_response) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[companyId,p.provider||'flow',amount,p.currency||'CLP',p.status||'pending',p.commerce_order||'',p.flow_token||'',p.flow_order?String(p.flow_order):'',raw]);
  return (await query('SELECT * FROM payments WHERE id=$1',[r[0].id]))[0];
}
async function getPaymentByFlowToken(token){ return (await query('SELECT * FROM payments WHERE flow_token=$1',[String(token||'')]))[0]||null; }
async function updatePaymentFromFlow(token,status,flowOrder,raw={}){
  const paidAt=String(status||'').toLowerCase()==='paid' ? iso(new Date()) : null;
  const rawText=JSON.stringify(raw||{}).slice(0,5000);
  await query('UPDATE payments SET status=$1,flow_order=COALESCE($2,flow_order),raw_response=$3,paid_at=COALESCE($4,paid_at) WHERE flow_token=$5',[status,flowOrder?String(flowOrder):null,rawText,paidAt,String(token||'')]);
  return getPaymentByFlowToken(token);
}
async function activateCompanyPaidFromPayment(token,raw={}){
  const payment=await getPaymentByFlowToken(token);
  if(!payment) throw new Error('Pago no encontrado.');
  const company=await updateCompanyPlan(payment.company_id,'paid');
  await updatePaymentFromFlow(token,'paid',raw.flowOrder||raw.flow_order||payment.flow_order,raw);
  return {payment:await getPaymentByFlowToken(token),company};
}
async function listCompanyPayments(companyId){ return query('SELECT id,provider,amount,currency,status,commerce_order,flow_order,created_at,paid_at FROM payments WHERE company_id=$1 ORDER BY id DESC LIMIT 20',[companyId]); }

async function companySubscriptionStatus(id){
  const c=await refreshCompanySubscription(id);
  const pub=companyPublic(c);
  if(!pub) return null;
  return {
    plan:pub.plan,
    plan_label:pub.plan_label,
    price:'0,5 UF/mes',
    period_days:30,
    subscription_active:pub.subscription_active,
    subscription_started_at:pub.subscription_started_at||null,
    subscription_ends_at:pub.subscription_ends_at||null,
    next_billing_date:pub.subscription_active && !pub.cancel_at_period_end ? pub.subscription_ends_at : null,
    cancel_at_period_end:pub.cancel_at_period_end,
    benefits_until:pub.subscription_active ? pub.subscription_ends_at : null,
    auto_renew:pub.subscription_active && !pub.cancel_at_period_end,
    permissions:pub.permissions,
    payments: await listCompanyPayments(id)
  };
}

async function updateCompanyPlan(id,plan){
  if(!['free','paid'].includes(plan)) throw new Error('Plan inválido');
  const c=await refreshCompanySubscription(id);
  if(!c) throw new Error('Empresa no encontrada.');
  if(plan==='paid'){
    const start=new Date();
    await query("UPDATE companies SET plan='paid',subscription_started_at=$1,subscription_ends_at=$2,cancel_at_period_end=0 WHERE id=$3",[iso(start),iso(addDays(start,30)),id]);
  }else{
    if(planActive(c)) await query('UPDATE companies SET cancel_at_period_end=1 WHERE id=$1',[id]);
    else await query("UPDATE companies SET plan='free',cancel_at_period_end=0 WHERE id=$1",[id]);
  }
  return getCompanyPublicById(id);
}
async function cancelCompanyPlan(id){
  const c=await refreshCompanySubscription(id);
  if(!c || !planActive(c)) return getCompanyPublicById(id);
  await query('UPDATE companies SET cancel_at_period_end=1 WHERE id=$1',[id]);
  return getCompanyPublicById(id);
}
async function activateCompanyPaid(id){ return updateCompanyPlan(id,'paid'); }
async function activateCompanyPaidByEmail(email){ const c=(await query('SELECT id FROM companies WHERE LOWER(email)=LOWER($1)',[String(email||'')]))[0]; if(!c) return null; return activateCompanyPaid(c.id); }
async function companyJobAllowance(id){ const c=await refreshCompanySubscription(id); const pub=companyPublic(c); if(!pub) return {can_create:false,reason:'Empresa no encontrada.'}; if(!canCompanyPublishJobs(pub)) return {can_create:false,reason:'Tu empresa debe estar verificada para publicar ofertas.'}; if(planActive(pub)) return {can_create:true,plan:'paid',active_open_jobs_limit:null,active_open_jobs_count:0}; const limit=freeOpenJobsLimit(); const row=(await query("SELECT COUNT(*) total FROM jobs WHERE company_id=$1 AND LOWER(COALESCE(estado,'abierto'))='abierto'",[id]))[0]||{total:0}; const count=Number(row.total||0); return {can_create:count<limit,plan:'free',active_open_jobs_limit:limit,active_open_jobs_count:count,reason:count<limit?'':'El plan Free permite una oferta abierta a la vez. Pausa/cierra una oferta o activa Pagado para publicar más.'}; }
async function getCompanyPublicById(id){ return companyPublic((await query('SELECT id,nombre,razon_social,rut_empresa,region,comuna,ubicacion,tipo_empresa,necesidad,email,whatsapp,plan,subscription_started_at,subscription_ends_at,cancel_at_period_end,verificada,rating,tamano_empresa,sitio_web,descripcion,email_verified FROM companies WHERE id=$1',[id]))[0]); }

async function getCompanyPublicPage(id){
  const company=await getCompanyPublicById(id);
  if(!company) return null;
  const jobs=await query(`SELECT j.id,j.titulo,j.region,j.comuna,j.ubicacion,j.licencia,j.salario,j.descripcion,j.estado,j.max_applications,j.created_at,COUNT(a.id) applications_count
    FROM jobs j LEFT JOIN applications a ON a.job_id=j.id
    WHERE j.company_id=$1
    GROUP BY j.id
    HAVING COALESCE(j.estado,'abierto')='abierto' AND (COALESCE(j.max_applications,0)=0 OR COUNT(a.id)<COALESCE(j.max_applications,0))
    ORDER BY j.id DESC LIMIT 12`,[id]);
  const reviews=await listReviews('company',id);
  const metrics=(await query(`SELECT COUNT(*) total_jobs,
    SUM(CASE WHEN COALESCE(j.estado,'abierto')='abierto' THEN 1 ELSE 0 END) open_jobs,
    COUNT(a.id) applications_count
    FROM jobs j LEFT JOIN applications a ON a.job_id=j.id WHERE j.company_id=$1`,[id]))[0]||{};
  return {
    company:{...company,email:null,whatsapp:null,rut_empresa:null,contact_locked:true},
    jobs,
    reviews,
    metrics:{total_jobs:Number(metrics.total_jobs||0),open_jobs:Number(metrics.open_jobs||0),applications_count:Number(metrics.applications_count||0)}
  };
}

async function updateCompanyProfile(id,c){ await query('UPDATE companies SET nombre=$1,razon_social=$2,rut_empresa=$3,region=$4,comuna=$5,ubicacion=$6,tipo_empresa=$7,necesidad=$8,whatsapp=$9,tamano_empresa=$10,sitio_web=$11,descripcion=$12 WHERE id=$13',[c.nombre,c.razon_social||'',normalizeCompanyRut(c.rut_empresa),c.region||'',c.comuna||'',loc(c),c.tipo_empresa,c.necesidad,c.whatsapp,c.tamano_empresa||'',c.sitio_web||'',c.descripcion||'',id]); return getCompanyPublicById(id); }
async function companyMetrics(id){ const jobs=await query('SELECT COUNT(*) total FROM jobs WHERE company_id=$1',[id]); const apps=await query('SELECT COUNT(*) total FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.company_id=$1',[id]); const searches=await query('SELECT COUNT(*) total FROM saved_searches WHERE company_id=$1',[id]); const favs=await query('SELECT COUNT(*) total FROM favorites WHERE company_id=$1',[id]); const contacts=await query('SELECT COUNT(*) total FROM contact_history WHERE company_id=$1',[id]); const locked=await query("SELECT COUNT(*) total FROM events WHERE company_id=$1 AND type='contact_attempt_locked'",[id]); return {jobs:Number(jobs[0].total),applications:Number(apps[0].total),saved_searches:Number(searches[0].total),favorites:Number(favs[0].total),contacts:Number(contacts[0].total),locked_contact_attempts:Number(locked[0].total)}; }
async function saveSearch(companyId,s){ const r=await query('INSERT INTO saved_searches(company_id,nombre,tipo,licencia,q,region) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[companyId,s.nombre||'Búsqueda personalizada',s.tipo||'todos',s.licencia||'todos',s.q||'',s.region||'']); return (await query('SELECT * FROM saved_searches WHERE id=$1',[r[0].id]))[0]; }
async function listSavedSearches(companyId){ return query('SELECT * FROM saved_searches WHERE company_id=$1 ORDER BY id DESC',[companyId]); }
async function deleteSavedSearch(companyId,id){ await query('DELETE FROM saved_searches WHERE company_id=$1 AND id=$2',[companyId,id]); return {ok:true}; }
function normalizeMaxApplications(value){ const n=Number(value||0); if(!Number.isFinite(n) || n<0) return 0; return Math.floor(n); }
function jobCapacityMeta(j){ const max=Number(j.max_applications||0); const count=Number(j.applications_count||0); return {...j,max_applications:max,applications_count:count,remaining_applications:max>0?Math.max(0,max-count):null,is_full:max>0 && count>=max}; }
async function normalizeJobPayload(j){ return {...j,estado:['abierto','pausado','cerrado'].includes(String(j.estado||'abierto').toLowerCase())?String(j.estado||'abierto').toLowerCase():'abierto'}; }
async function createJob(companyId,j){ j=await normalizeJobPayload(j); const max=normalizeMaxApplications(j.max_applications); const r=await query('INSERT INTO jobs(company_id,titulo,region,comuna,ubicacion,licencia,salario,descripcion,estado,max_applications) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',[companyId,j.titulo,j.region||'',j.comuna||'',loc(j),j.licencia,j.salario||'',j.descripcion,j.estado,max]); const job=(await query('SELECT j.*,0 applications_count FROM jobs j WHERE id=$1',[r[0].id]))[0]; const matches=await query('SELECT id FROM profiles WHERE (region=$1 OR licencia=$2) LIMIT 20',[j.region||'',j.licencia||'']); for(const m of matches) await createNotification('profile',m.id,'Nueva oferta que podría interesarte',`${j.titulo} · ${j.comuna||''}, ${j.region||''}`); await trackEvent('job_created',{company_id:companyId,target_type:'job',target_id:job.id,metadata:{max_applications:max}}); return jobCapacityMeta(job); }
async function listCompanyJobs(companyId){ const rows=await query('SELECT j.*,COUNT(a.id) applications_count FROM jobs j LEFT JOIN applications a ON a.job_id=j.id WHERE j.company_id=$1 GROUP BY j.id ORDER BY j.id DESC',[companyId]); return rows.map(jobCapacityMeta); }
async function deleteCompanyJob(companyId,jobId){ const existing=(await query('SELECT id,titulo FROM jobs WHERE id=$1 AND company_id=$2',[jobId,companyId]))[0]; if(!existing) return null; await query('DELETE FROM applications WHERE job_id=$1',[jobId]); await query('DELETE FROM jobs WHERE id=$1 AND company_id=$2',[jobId,companyId]); return existing; }
async function updateCompanyJob(companyId,jobId,j){ const existing=(await query('SELECT * FROM jobs WHERE id=$1 AND company_id=$2',[jobId,companyId]))[0]; if(!existing) return null; j=await normalizeJobPayload({...existing,...j}); const max=normalizeMaxApplications(j.max_applications); await query('UPDATE jobs SET titulo=$1,region=$2,comuna=$3,ubicacion=$4,licencia=$5,salario=$6,descripcion=$7,estado=$8,max_applications=$9 WHERE id=$10 AND company_id=$11',[j.titulo,j.region||'',j.comuna||'',loc(j),j.licencia,j.salario||'',j.descripcion,j.estado,max,jobId,companyId]); return getJobById(jobId,{includeClosed:true,includeFull:true}); }
async function updateCompanyJobStatus(companyId,jobId,estado){ estado=String(estado||'').toLowerCase(); if(!['abierto','pausado','cerrado'].includes(estado)) throw new Error('Estado de oferta inválido.'); const existing=(await query('SELECT id,titulo FROM jobs WHERE id=$1 AND company_id=$2',[jobId,companyId]))[0]; if(!existing) return null; await query('UPDATE jobs SET estado=$1 WHERE id=$2 AND company_id=$3',[estado,jobId,companyId]); return getJobById(jobId,{includeClosed:true,includeFull:true}); }
async function getJobById(jobId,opts={}){ const where=['j.id=$1']; if(!opts.includeClosed) where.push("COALESCE(j.estado,'abierto')='abierto'"); const rows=await query(`SELECT j.*,c.nombre empresa,c.verificada empresa_verificada,COUNT(a.id) applications_count FROM jobs j JOIN companies c ON c.id=j.company_id LEFT JOIN applications a ON a.job_id=j.id WHERE ${where.join(' AND ')} GROUP BY j.id,c.nombre,c.verificada`,[jobId]); const job=rows[0]?jobCapacityMeta(rows[0]):null; if(!job || (!opts.includeFull && job.is_full)) return null; return job; }
async function listJobs(f={}){ const where=["COALESCE(j.estado,'abierto')='abierto'"],params=[]; if(f.q){params.push(`%${String(f.q).toLowerCase()}%`); where.push(`(LOWER(j.titulo) LIKE $${params.length} OR LOWER(j.region) LIKE $${params.length} OR LOWER(j.comuna) LIKE $${params.length} OR LOWER(j.descripcion) LIKE $${params.length} OR LOWER(c.nombre) LIKE $${params.length})`)} if(f.licencia&&f.licencia!=='todos'){params.push(f.licencia); where.push(`j.licencia=$${params.length}`)} if(f.region){params.push(f.region); where.push(`j.region=$${params.length}`)} if(f.comuna){params.push(`%${String(f.comuna).toLowerCase()}%`); where.push(`LOWER(j.comuna) LIKE $${params.length}`)} const rows=await query(`SELECT j.*,c.nombre empresa,c.verificada empresa_verificada,COUNT(a.id) applications_count FROM jobs j JOIN companies c ON c.id=j.company_id LEFT JOIN applications a ON a.job_id=j.id ${where.length?'WHERE '+where.join(' AND '):''} GROUP BY j.id,c.nombre,c.verificada ORDER BY j.id DESC`,params); return rows.map(jobCapacityMeta).filter(j=>!j.is_full); }
async function applyToJob(profileId,a){
  const p=(await query('SELECT * FROM profiles WHERE id=$1',[profileId]))[0];
  if(!p) throw new Error('Perfil no encontrado');
  const job=(await query('SELECT j.*,c.id company_id FROM jobs j JOIN companies c ON c.id=j.company_id WHERE j.id=$1',[a.job_id]))[0];
  if(!job) throw new Error('Oferta no encontrada');
  if(String(job.estado||'abierto').toLowerCase()!=='abierto') throw new Error('Esta oferta no está abierta para postulaciones.');
  if(p.licencia && job.licencia && job.licencia!=='todos' && p.licencia!==job.licencia){ const err=new Error('Tu licencia no es compatible con esta oferta.'); err.code='INCOMPATIBLE_JOB'; throw err; }
  const existing=(await query('SELECT * FROM applications WHERE job_id=$1 AND profile_id=$2 LIMIT 1',[a.job_id,profileId]))[0];
  if(existing){ const err=new Error('Ya postulaste a esta oferta. Puedes revisar el estado en Mis oportunidades.'); err.code='DUPLICATE_APPLICATION'; err.application=existing; throw err; }
  const capacity=(await query('SELECT COUNT(*) applications_count FROM applications WHERE job_id=$1',[a.job_id]))[0];
  const maxApplications=Number(job.max_applications||0);
  if(maxApplications>0 && Number(capacity.applications_count||0)>=maxApplications){ const err=new Error('Esta oferta alcanzó el máximo de postulaciones definido por la empresa.'); err.code='APPLICATION_LIMIT_REACHED'; throw err; }
  try{
    const r=await query('INSERT INTO applications(job_id,profile_id,nombre,email,whatsapp,mensaje) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[a.job_id,profileId,p.nombre,p.email||'',p.whatsapp,a.mensaje||'']);
    await addApplicationHistory(r[0].id,'profile',profileId,'nuevo',a.mensaje||'Postulación enviada.');
    await createNotification('company',job.company_id,'Nueva postulación recibida',`${p.nombre} postuló a ${job.titulo}`);
    await trackEvent('application_created',{profile_id:profileId,target_type:'job',target_id:a.job_id});
    return (await query('SELECT * FROM applications WHERE id=$1',[r[0].id]))[0];
  }catch(e){
    if(String(e.message||'').includes('UNIQUE') || String(e.code||'')==='23505'){ const err=new Error('Ya postulaste a esta oferta. Puedes revisar el estado en Mis oportunidades.'); err.code='DUPLICATE_APPLICATION'; throw err; }
    throw e;
  }
}
async function listApplicationsForCompany(companyId){ return attachApplicationHistory(await query('SELECT a.*,j.titulo trabajo,p.tipo perfil_tipo,p.verificado perfil_verificado FROM applications a JOIN jobs j ON j.id=a.job_id LEFT JOIN profiles p ON p.id=a.profile_id WHERE j.company_id=$1 ORDER BY a.id DESC',[companyId])); }
async function listApplicationsForProfile(profileId){ return attachApplicationHistory(await query(`SELECT a.*,j.titulo trabajo,j.region,j.comuna,j.salario,j.licencia,c.nombre empresa,c.verificada empresa_verificada,c.id company_id FROM applications a JOIN jobs j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id WHERE a.profile_id=$1 ORDER BY a.id DESC`,[profileId])); }
async function stats(){ const p=await query('SELECT COUNT(*) total FROM profiles'),c=await query('SELECT COUNT(*) total FROM companies'),j=await query('SELECT COUNT(*) total FROM jobs'),t=await query('SELECT COUNT(*) total FROM trucks'); return {profiles:Number(p[0].total),companies:Number(c[0].total),jobs:Number(j[0].total),trucks:Number(t[0].total)}; }
function clampRating(v){v=Number(v||0);if(v<1)v=1;if(v>5)v=5;return Math.round(v)}
function isReviewableStatus(status){ return BUSINESS_RULES.reviewable_statuses.includes(String(status||'').toLowerCase()); }
async function reviewableProfileApplications(companyId, profileId){
  return query(`SELECT a.*,j.titulo trabajo,j.company_id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.company_id=$1 AND a.profile_id=$2 AND LOWER(COALESCE(a.status,'')) IN ('contactado','entrevista','contratado') ORDER BY a.id DESC`,[companyId,profileId]);
}
async function reviewableCompanyApplications(profileId, companyId){
  return query(`SELECT a.*,j.titulo trabajo,j.company_id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.profile_id=$1 AND j.company_id=$2 AND LOWER(COALESCE(a.status,'')) IN ('contactado','entrevista','contratado') ORDER BY a.id DESC`,[profileId,companyId]);
}
async function createProfileReview(companyId,profileId,r){
  const company=await getCompanyPublicById(companyId);
  if(!canCompanyUnlockContacts(company)) throw new Error('Para evaluar perfiles tu empresa debe estar verificada y tener plan Pagado activo.');
  const apps=await reviewableProfileApplications(companyId,profileId);
  if(!apps[0]) throw new Error('Solo puedes evaluar perfiles con una postulación marcada como Contactado, Entrevista o Contratado y con empresa verificada en plan Pagado.');
  const applicationId=Number(r.application_id||apps[0].id);
  if(!apps.some(a=>Number(a.id)===applicationId)) throw new Error('La postulación seleccionada no es válida para evaluar.');
  const prior=(await query('SELECT id FROM reviews WHERE target_type=$1 AND target_id=$2 AND from_company_id=$3 AND application_id=$4',['profile',profileId,companyId,applicationId]))[0];
  if(prior) throw new Error('Esta relación laboral ya fue evaluada por tu empresa.');
  const vals=[clampRating(r.rating),clampRating(r.criterio_1||r.rating),clampRating(r.criterio_2||r.rating),clampRating(r.criterio_3||r.rating),String(r.comment||'').slice(0,600),applicationId];
  const rr=await query('INSERT INTO reviews(target_type,target_id,from_company_id,reviewer_name,reviewer_type,rating,criterio_1,criterio_2,criterio_3,comment,application_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',['profile',profileId,companyId,'Empresa registrada','empresa',...vals,'publicada']);
  return (await query('SELECT * FROM reviews WHERE id=$1',[rr[0].id]))[0];
}
async function createCompanyReview(profileId,companyId,r){
  const profile=(await query('SELECT * FROM profiles WHERE id=$1',[profileId]))[0];
  if(!profile) throw new Error('Perfil no encontrado.');
  const apps=await reviewableCompanyApplications(profileId,companyId);
  if(!apps[0]) throw new Error('Solo puedes evaluar empresas con una postulación tuya marcada como Contactado, Entrevista o Contratado.');
  const applicationId=Number(r.application_id||apps[0].id);
  if(!apps.some(a=>Number(a.id)===applicationId)) throw new Error('La postulación seleccionada no es válida para evaluar.');
  const prior=(await query('SELECT id FROM reviews WHERE target_type=$1 AND target_id=$2 AND reviewer_profile_id=$3 AND application_id=$4',['company',companyId,profileId,applicationId]))[0];
  if(prior) throw new Error('Ya evaluaste esta relación con la empresa.');
  const vals=[profile.nombre,String(profile.tipo||'Perfil registrado').slice(0,80),clampRating(r.rating),clampRating(r.criterio_1||r.rating),clampRating(r.criterio_2||r.rating),clampRating(r.criterio_3||r.rating),String(r.comment||'').slice(0,600),applicationId,profileId];
  const rr=await query('INSERT INTO reviews(target_type,target_id,reviewer_name,reviewer_type,rating,criterio_1,criterio_2,criterio_3,comment,application_id,reviewer_profile_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',['company',companyId,...vals,'publicada']);
  return (await query('SELECT * FROM reviews WHERE id=$1',[rr[0].id]))[0];
}
async function listReviews(targetType,targetId){ return query(`SELECT r.*,c.nombre from_company,p.nombre reviewer_profile_name,a.status application_status,a.id application_ref FROM reviews r LEFT JOIN companies c ON c.id=r.from_company_id LEFT JOIN profiles p ON p.id=r.reviewer_profile_id LEFT JOIN applications a ON a.id=r.application_id WHERE r.target_type=$1 AND r.target_id=$2 AND COALESCE(r.status,'publicada')='publicada' ORDER BY r.id DESC LIMIT 20`,[targetType,targetId]); }
async function addApplicationHistory(applicationId,changedByType,changedById,status,message=''){
  await query('INSERT INTO application_status_history(application_id,changed_by_type,changed_by_id,status,message) VALUES($1,$2,$3,$4,$5)',[applicationId,changedByType,changedById,String(status||'').toLowerCase(),String(message||'').slice(0,800)]);
}
async function applicationHistory(applicationId){
  return query('SELECT * FROM application_status_history WHERE application_id=$1 ORDER BY id ASC',[applicationId]);
}
async function attachApplicationHistory(rows){
  const out=[];
  for(const r of rows){ out.push({...r,status_history:await applicationHistory(r.id)}); }
  return out;
}
async function updateApplicationStatus(companyId,applicationId,status,message=''){
  const allowed=['nuevo','contactado','entrevista','contratado','descartado','cerrado'];
  const next=String(status||'').toLowerCase();
  if(!allowed.includes(next)) throw new Error('Estado inválido.');
  const company=await getCompanyPublicById(companyId);
  if(!canCompanyMoveApplicationTo(next,company)) throw new Error(['contactado','entrevista','contratado'].includes(next)?'Para avanzar una postulación a contacto, entrevista o contratado la empresa debe estar verificada y con plan Pagado activo.':'Tu empresa debe estar verificada para gestionar postulaciones.');
  const app=(await query('SELECT a.*,j.titulo,j.company_id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=$1 AND j.company_id=$2',[applicationId,companyId]))[0];
  if(!app) throw new Error('Postulación no encontrada para tu empresa.');
  if(String(app.status||'').toLowerCase()==='retirada') throw new Error('Esta postulación fue retirada por el trabajador y ya no puede cambiarse.');
  await query('UPDATE applications SET status=$1 WHERE id=$2',[next,applicationId]);
  await addApplicationHistory(applicationId,'company',companyId,next,message);
  if(app.profile_id) await createNotification('profile',app.profile_id,'Estado de postulación actualizado',`Tu postulación a ${app.titulo} cambió a ${next}${message?': '+String(message).slice(0,140):''}`);
  await trackEvent('application_status_updated',{company_id:companyId,profile_id:app.profile_id,target_type:'application',target_id:applicationId,metadata:{status:next}});
  return (await attachApplicationHistory(await query('SELECT * FROM applications WHERE id=$1',[applicationId])))[0];
}
async function withdrawApplication(profileId,applicationId,message=''){
  const app=(await query('SELECT a.*,j.titulo,j.company_id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=$1 AND a.profile_id=$2',[applicationId,profileId]))[0];
  if(!app) throw new Error('Postulación no encontrada para tu perfil.');
  const current=String(app.status||'nuevo').toLowerCase();
  if(['contratado','cerrado'].includes(current)) throw new Error('No puedes retirar una postulación ya contratada o cerrada. Contacta a la empresa.');
  if(current==='retirada') return (await attachApplicationHistory(await query('SELECT * FROM applications WHERE id=$1',[applicationId])))[0];
  await query("UPDATE applications SET status='retirada' WHERE id=$1",[applicationId]);
  await addApplicationHistory(applicationId,'profile',profileId,'retirada',message||'Postulación retirada por el trabajador.');
  await createNotification('company',app.company_id,'Postulación retirada',`${app.nombre} retiró su postulación a ${app.titulo}.`);
  await trackEvent('application_withdrawn',{profile_id:profileId,target_type:'application',target_id:applicationId});
  return (await attachApplicationHistory(await query('SELECT * FROM applications WHERE id=$1',[applicationId])))[0];
}
async function canCompanyReviewProfile(companyId,profileId){ const apps=await reviewableProfileApplications(companyId,profileId); return {can_review:Boolean(apps[0]),applications:apps}; }
async function canProfileReviewCompany(profileId,companyId){ const apps=await reviewableCompanyApplications(profileId,companyId); return {can_review:Boolean(apps[0]),applications:apps}; }
async function listPendingDocuments(){
  return query(`SELECT id,tipo,nombre,rut,region,comuna,licencia,licencia_vencimiento,documento_estado,created_at FROM profiles WHERE documento_estado='pendiente' AND (documento_licencia<>'' OR hoja_vida_conductor<>'') ORDER BY id DESC LIMIT 100`);
}
async function adminSummary(){
  const one = async (sql,params=[]) => Number(((await query(sql,params))[0]||{}).total||0);
  // Compatibilidad PostgreSQL/SQLite: en instalaciones antiguas algunas fechas quedaron como TEXT.
  // PostgreSQL no permite comparar TEXT directamente contra TIMESTAMPTZ, por eso se castea de forma segura.
  const dateExpr = col => client==='postgres' ? `(NULLIF(${col}::text,'')::timestamptz)` : col;
  const since24h = client==='postgres' ? `CURRENT_TIMESTAMP - INTERVAL '24 hours'` : `datetime('now','-24 hours')`;
  const since7d = client==='postgres' ? `CURRENT_TIMESTAMP - INTERVAL '7 days'` : `datetime('now','-7 days')`;
  const nowExpr = client==='postgres' ? `CURRENT_TIMESTAMP` : `datetime('now')`;

  const companies=await one('SELECT COUNT(*) total FROM companies');
  const verifiedCompanies=await one('SELECT COUNT(*) total FROM companies WHERE verificada IS TRUE');
  const paidCompanies=await one(`SELECT COUNT(*) total FROM companies WHERE plan='paid' AND subscription_ends_at IS NOT NULL AND ${dateExpr('subscription_ends_at')} > ${nowExpr}`);
  const unverifiedCompanyEmails=await one('SELECT COUNT(*) total FROM companies WHERE email_verified IS NOT TRUE');
  const profiles=await one('SELECT COUNT(*) total FROM profiles');
  const verifiedProfiles=await one('SELECT COUNT(*) total FROM profiles WHERE verificado IS TRUE');
  const unverifiedProfileEmails=await one('SELECT COUNT(*) total FROM profiles WHERE email_verified IS NOT TRUE');
  const pendingDocs=await one("SELECT COUNT(*) total FROM profiles WHERE documento_estado='pendiente' AND (documento_licencia<>'' OR hoja_vida_conductor<>'')");
  const rejectedDocs=await one("SELECT COUNT(*) total FROM profiles WHERE documento_estado='rechazado'");
  const jobs=await one('SELECT COUNT(*) total FROM jobs');
  const openJobs=await one("SELECT COUNT(*) total FROM jobs WHERE COALESCE(estado,'abierto')='abierto'");
  const applications=await one('SELECT COUNT(*) total FROM applications');
  const appsToday=await one(`SELECT COUNT(*) total FROM applications WHERE ${dateExpr('created_at')} >= ${since24h}`);
  const eventsToday=await one(`SELECT COUNT(*) total FROM events WHERE ${dateExpr('created_at')} >= ${since24h}`);
  const fraudAlerts=await one(`SELECT COUNT(*) total FROM events WHERE type LIKE 'fraud_%' AND ${dateExpr('created_at')} >= ${since7d}`);
  const failedLogins=await one(`SELECT COUNT(*) total FROM events WHERE type IN ('login_failed_company','login_failed_profile','login_failed_admin') AND ${dateExpr('created_at')} >= ${since24h}`);
  const topEvents=await query(`SELECT type,COUNT(*) total FROM events WHERE ${dateExpr('created_at')} >= ${since7d} GROUP BY type ORDER BY COUNT(*) DESC LIMIT 8`);
  return {companies,verified_companies:verifiedCompanies,paid_companies:paidCompanies,unverified_company_emails:unverifiedCompanyEmails,profiles,verified_profiles:verifiedProfiles,unverified_profile_emails:unverifiedProfileEmails,pending_documents:pendingDocs,rejected_documents:rejectedDocs,jobs,open_jobs:openJobs,applications,applications_today:appsToday,events_today:eventsToday,fraud_alerts_7d:fraudAlerts,failed_logins_24h:failedLogins,top_events:topEvents.map(e=>({type:e.type,total:Number(e.total||0)}))};
}
async function adminListCompanies(f={}){
  const where=[],params=[];
  if(f.q){ params.push('%'+String(f.q).toLowerCase()+'%'); where.push('(LOWER(nombre) LIKE $'+params.length+' OR LOWER(email) LIKE $'+params.length+' OR LOWER(rut_empresa) LIKE $'+params.length+' OR LOWER(region) LIKE $'+params.length+')'); }
  if(f.estado==='verificadas') where.push('(verificada IS TRUE)');
  if(f.estado==='pendientes') where.push('(verificada IS NOT TRUE)');
  const rows=await query('SELECT c.id,c.nombre,c.razon_social,c.rut_empresa,c.region,c.comuna,c.tipo_empresa,c.necesidad,c.email,c.whatsapp,c.plan,c.verificada,c.rating,c.tamano_empresa,c.sitio_web,c.descripcion,c.documento_empresa,c.created_at,COUNT(DISTINCT j.id) jobs_count,COUNT(DISTINCT a.id) applications_count FROM companies c LEFT JOIN jobs j ON j.company_id=c.id LEFT JOIN applications a ON a.job_id=j.id '+(where.length?'WHERE '+where.join(' AND '):'')+' GROUP BY c.id ORDER BY c.id DESC LIMIT 300',params);
  return rows.map(r=>({...r,verificada:Boolean(r.verificada),jobs_count:Number(r.jobs_count||0),applications_count:Number(r.applications_count||0)}));
}
async function adminListProfiles(f={}){
  const where=[],params=[];
  if(f.q){ params.push('%'+String(f.q).toLowerCase()+'%'); where.push('(LOWER(p.nombre) LIKE $'+params.length+' OR LOWER(p.rut) LIKE $'+params.length+' OR LOWER(p.region) LIKE $'+params.length+' OR LOWER(p.especialidad) LIKE $'+params.length+')'); }
  if(f.tipo&&f.tipo!=='todos'){ params.push(f.tipo); where.push('p.tipo=$'+params.length); }
  if(f.estado&&f.estado!=='todos'){ params.push(f.estado); where.push('p.documento_estado=$'+params.length); }
  const rows=await query('SELECT p.id,p.tipo,p.nombre,p.rut,p.region,p.comuna,p.licencia,p.experiencia,p.especialidad,p.disponibilidad,p.verificado,p.email,p.whatsapp,p.documento_licencia,p.hoja_vida_conductor,p.licencia_vencimiento,p.documento_estado,p.created_at,COUNT(t.id) trucks_count FROM profiles p LEFT JOIN trucks t ON t.profile_id=p.id '+(where.length?'WHERE '+where.join(' AND '):'')+' GROUP BY p.id ORDER BY p.id DESC LIMIT 300',params);
  return rows.map(r=>({...r,verificado:Boolean(r.verificado),has_licencia:Boolean(r.documento_licencia),has_hoja_vida:Boolean(r.hoja_vida_conductor),trucks_count:Number(r.trucks_count||0)}));
}
async function adminListJobs(){ return query('SELECT j.*,c.nombre empresa,c.email empresa_email,COUNT(a.id) applications_count FROM jobs j JOIN companies c ON c.id=j.company_id LEFT JOIN applications a ON a.job_id=j.id GROUP BY j.id,c.nombre,c.email ORDER BY j.id DESC LIMIT 300'); }
async function adminListApplications(){ return query('SELECT a.*,j.titulo trabajo,p.tipo perfil_tipo,p.verificado perfil_verificado,c.nombre empresa,c.email empresa_email FROM applications a JOIN jobs j ON j.id=a.job_id LEFT JOIN profiles p ON p.id=a.profile_id JOIN companies c ON c.id=j.company_id ORDER BY a.id DESC LIMIT 300'); }
async function adminUpdateProfileVerification(id,data={}){
  if(data.documento_estado!==undefined) await query('UPDATE profiles SET documento_estado=$1 WHERE id=$2',[data.documento_estado,id]);
  if(data.verificado!==undefined) await query('UPDATE profiles SET verificado=$1 WHERE id=$2',[client==='postgres'?Boolean(data.verificado):(data.verificado?1:0),id]);
  return (await adminListProfiles({q:''})).find(x=>String(x.id)===String(id));
}
async function adminUpdateCompanyVerification(id,data={}){
  if(data.verificada!==undefined) await query('UPDATE companies SET verificada=$1 WHERE id=$2',[client==='postgres'?Boolean(data.verificada):(data.verificada?1:0),id]);
  if(data.plan!==undefined) await updateCompanyPlan(id,data.plan);
  return (await adminListCompanies({q:''})).find(x=>String(x.id)===String(id));
}
async function adminGetCompanyDocument(id){
  const c=(await query('SELECT documento_empresa,email_verified FROM companies WHERE id=$1',[id]))[0];
  if(!c) return null;
  return {path:c.documento_empresa};
}


async function adminDeleteCompany(id){
  const existing=(await query('SELECT id,nombre,email FROM companies WHERE id=$1',[id]))[0];
  if(!existing) return null;
  await query('DELETE FROM company_sessions WHERE company_id=$1',[id]);
  await query('DELETE FROM saved_searches WHERE company_id=$1',[id]);
  await query('DELETE FROM favorites WHERE company_id=$1',[id]);
  await query('DELETE FROM contact_history WHERE company_id=$1',[id]);
  await query('DELETE FROM notifications WHERE user_type=$1 AND user_id=$2',['company',id]);
  await query('DELETE FROM events WHERE company_id=$1',[id]);
  await query('DELETE FROM companies WHERE id=$1',[id]);
  return existing;
}
async function adminDeleteProfile(id){
  const existing=(await query('SELECT id,nombre,email FROM profiles WHERE id=$1',[id]))[0];
  if(!existing) return null;
  await query('DELETE FROM profile_sessions WHERE profile_id=$1',[id]);
  await query('UPDATE applications SET profile_id=NULL WHERE profile_id=$1',[id]);
  await query('DELETE FROM favorites WHERE profile_id=$1',[id]);
  await query('DELETE FROM contact_history WHERE profile_id=$1',[id]);
  await query('DELETE FROM reviews WHERE reviewer_profile_id=$1',[id]);
  await query('DELETE FROM notifications WHERE user_type=$1 AND user_id=$2',['profile',id]);
  await query('DELETE FROM events WHERE profile_id=$1',[id]);
  await query('DELETE FROM profiles WHERE id=$1',[id]);
  return existing;
}

async function adminGetProfileDocument(id,kind){
  const p=(await query('SELECT documento_licencia,hoja_vida_conductor FROM profiles WHERE id=$1',[id]))[0];
  if(!p) return null;
  return {path: kind==='hoja-vida'?p.hoja_vida_conductor:p.documento_licencia};
}


async function createPasswordReset(userType,email){
  userType=String(userType||'company').toLowerCase()==='profile'?'profile':'company';
  const table=userType==='profile'?'profiles':'companies';
  const row=(await query(`SELECT id,email,nombre FROM ${table} WHERE LOWER(email)=LOWER($1)`,[String(email||'')]))[0];
  if(!row) return null;
  const token=makeToken();
  const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
  const expires=iso(addDays(new Date(),1));
  await query(`UPDATE ${table} SET password_reset_token_hash=$1,password_reset_expires_at=$2 WHERE id=$3`,[tokenHash,expires,row.id]);
  await trackEvent('password_reset_requested',{[userType==='profile'?'profile_id':'company_id']:row.id,metadata:{email:row.email,user_type:userType}});
  return {user_type:userType,id:row.id,email:row.email,nombre:row.nombre,token,expires_at:expires};
}
async function resetPasswordByToken(token,newPassword){
  if(!token || String(newPassword||'').length<6) throw new Error('Token inválido o contraseña demasiado corta.');
  const hash=crypto.createHash('sha256').update(String(token)).digest('hex');
  for(const cfg of [{type:'company',table:'companies',session:'company_sessions',fk:'company_id'},{type:'profile',table:'profiles',session:'profile_sessions',fk:'profile_id'}]){
    const row=(await query(`SELECT id,email,password_reset_expires_at FROM ${cfg.table} WHERE password_reset_token_hash=$1`,[hash]))[0];
    if(row){
      if(row.password_reset_expires_at && new Date(row.password_reset_expires_at).getTime()<Date.now()) throw new Error('El enlace de recuperación venció. Solicita uno nuevo.');
      await query(`UPDATE ${cfg.table} SET password_hash=$1,password_reset_token_hash=NULL,password_reset_expires_at=NULL WHERE id=$2`,[hpw(newPassword),row.id]);
      await query(`DELETE FROM ${cfg.session} WHERE ${cfg.fk}=$1`,[row.id]);
      await trackEvent('password_reset_completed',{[cfg.type==='profile'?'profile_id':'company_id']:row.id,metadata:{email:row.email,user_type:cfg.type}});
      return {ok:true,user_type:cfg.type,email:row.email};
    }
  }
  throw new Error('Enlace de recuperación inválido.');
}
async function adminAuditEvents(limit=100){
  const n=Math.min(Math.max(Number(limit)||100,1),300);
  const rows=await query(`SELECT e.*,c.nombre company_name,c.email company_email,p.nombre profile_name,p.email profile_email FROM events e LEFT JOIN companies c ON c.id=e.company_id LEFT JOIN profiles p ON p.id=e.profile_id ORDER BY e.id DESC LIMIT $1`,[n]);
  return rows.map(r=>({...r,metadata:typeof r.metadata==='string'?safeJson(r.metadata):r.metadata}));
}
function safeJson(v){ try{return JSON.parse(v||'{}')}catch{return {raw:v}} }
async function fraudSignals(){
  const recent=await query(`SELECT * FROM events WHERE type LIKE 'fraud_%' OR type IN ('login_failed_company','login_failed_profile','login_failed_admin','password_reset_requested') ORDER BY id DESC LIMIT 100`);
  const duplicateCompanyEmail=await query(`SELECT LOWER(email) email,COUNT(*) total FROM companies GROUP BY LOWER(email) HAVING COUNT(*)>1 LIMIT 20`);
  const duplicateProfileEmail=await query(`SELECT LOWER(email) email,COUNT(*) total FROM profiles WHERE email<>'' GROUP BY LOWER(email) HAVING COUNT(*)>1 LIMIT 20`);
  const duplicatePhones=await query(`SELECT whatsapp,COUNT(*) total FROM (SELECT whatsapp FROM companies UNION ALL SELECT whatsapp FROM profiles) x WHERE whatsapp<>'' GROUP BY whatsapp HAVING COUNT(*)>1 LIMIT 20`);
  return {recent:recent.map(r=>({...r,metadata:typeof r.metadata==='string'?safeJson(r.metadata):r.metadata})),duplicates:{company_emails:duplicateCompanyEmail,profile_emails:duplicateProfileEmail,phones:duplicatePhones}};
}

async function reputationSummary(){ const topProfiles=await query(`SELECT p.id,p.tipo,p.nombre,p.region,p.comuna,p.licencia,p.especialidad,p.verificado,AVG(r.rating) rating,COUNT(r.id) reviews_count FROM profiles p JOIN reviews r ON r.target_type='profile' AND r.target_id=p.id GROUP BY p.id HAVING COUNT(r.id)>0 ORDER BY rating DESC,reviews_count DESC LIMIT 5`); const topCompanies=await query(`SELECT c.id,c.nombre,c.tipo_empresa,c.region,c.comuna,c.verificada,AVG(r.rating) rating,COUNT(r.id) reviews_count FROM companies c JOIN reviews r ON r.target_type='company' AND r.target_id=c.id GROUP BY c.id HAVING COUNT(r.id)>0 ORDER BY rating DESC,reviews_count DESC LIMIT 5`); return {topProfiles:topProfiles.map(x=>({...x,verificado:Boolean(x.verificado),rating:Number(x.rating||0),reviews_count:Number(x.reviews_count||0)})),topCompanies:topCompanies.map(x=>({...x,verificada:Boolean(x.verificada),rating:Number(x.rating||0),reviews_count:Number(x.reviews_count||0)}))}; }

function normText(v){ return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function uniq(arr){ return [...new Set(arr.filter(Boolean))]; }
function containsAny(text, words){ const t=normText(text); return words.some(w=>w && t.includes(normText(w))); }
function availabilityScore(v){ const t=normText(v); if(t.includes('hoy')||t.includes('ahora')||t.includes('inmediata')) return 15; if(t.includes('48')) return 10; if(t.includes('semana')) return 7; if(t.includes('no disponible')) return -10; return 3; }
function truckComplianceScore(trucks=[]){ let best=0; for(const t of trucks){ let s=0; if(normText(t.revision_tecnica)==='si') s+=3; if(normText(t.permiso_circulacion)==='si') s+=3; if(normText(t.soap)==='si') s+=2; if(normText(t.seguro_vigente)==='si') s+=2; best=Math.max(best,s); } return best; }
function matchReasons(p,ctx,scoreParts){ const r=[]; if(scoreParts.region>0) r.push('misma región'); if(scoreParts.comuna>0) r.push('misma comuna'); if(scoreParts.licencia>0) r.push('licencia requerida'); if(scoreParts.especialidad>0) r.push('especialidad alineada'); if(scoreParts.disponibilidad>=10) r.push('disponible rápido'); if(scoreParts.rating>=8) r.push('alta reputación'); if(scoreParts.verificado>0) r.push('perfil verificado'); if(scoreParts.camion>=8) r.push('camión con documentación al día'); if(!r.length) r.push('perfil activo para revisar'); return r.slice(0,4); }
async function recommendProfilesForCompany(companyId,opts={}){
  const company=(await query('SELECT * FROM companies WHERE id=$1',[companyId]))[0];
  if(!company) return [];
  let jobs=[];
  if(opts.job_id){
    jobs=await query('SELECT * FROM jobs WHERE company_id=$1 AND id=$2',[companyId,opts.job_id]);
  }
  if(!jobs.length) jobs=await query('SELECT * FROM jobs WHERE company_id=$1 ORDER BY id DESC LIMIT 5',[companyId]);
  const saved=await query('SELECT * FROM saved_searches WHERE company_id=$1 ORDER BY id DESC LIMIT 5',[companyId]);
  const targetRegions=uniq([opts.region,company.region,...jobs.map(j=>j.region),...saved.map(x=>x.region)]);
  const targetComunas=uniq([company.comuna,...jobs.map(j=>j.comuna)]);
  const targetLicenses=uniq([opts.licencia,...jobs.map(j=>j.licencia),...saved.map(x=>x.licencia)].filter(x=>x&&x!=='todos'));
  const rawText=[company.necesidad,company.tipo_empresa,company.descripcion,...jobs.flatMap(j=>[j.titulo,j.descripcion,j.licencia]),...saved.map(s=>s.q)].join(' ');
  const preferredTypes=[];
  const nt=normText(rawText);
  if(nt.includes('chofer')) preferredTypes.push('Chofer');
  if(nt.includes('peoneta')) preferredTypes.push('Peoneta');
  if(nt.includes('dueno')||nt.includes('dueño')||nt.includes('camion')||nt.includes('camión')) preferredTypes.push('Dueño de camión');
  const specialtyWords=uniq(['mineria','minera','faena','puerto','contenedor','forestal','refrigerado','frigorifico','carga peligrosa','retail','distribucion','nacional','internacional','carga pesada','rampla','tolva','aljibe','ultima milla','bodega','ruta'].filter(w=>containsAny(rawText,[w])));
  const profilesResult=await listProfiles({limit:1000},company);
  const profiles=profilesResult.profiles||[];
  const ranked=profiles.map(p=>{
    const scoreParts={};
    scoreParts.tipo=preferredTypes.includes(p.tipo)?18:0;
    scoreParts.region=targetRegions.includes(p.region)?24:0;
    scoreParts.comuna=targetComunas.includes(p.comuna)?14:0;
    scoreParts.licencia=(targetLicenses.length && targetLicenses.includes(p.licencia))?26:(!targetLicenses.length?4:-8);
    const profileText=[p.especialidad,p.rutas,p.descripcion,p.tipo,(p.trucks||[]).map(t=>[t.tipo,t.marca_modelo,t.disponibilidad,t.capacidad_toneladas].join(' ')).join(' ')].join(' ');
    scoreParts.especialidad=specialtyWords.length && containsAny(profileText,specialtyWords)?18:0;
    scoreParts.disponibilidad=availabilityScore(p.disponibilidad);
    scoreParts.rating=Math.min(14,Number(p.reputation_rating||0)*2.8);
    scoreParts.verificado=p.verificado?12:0;
    scoreParts.experiencia=Math.min(12,Math.max(0,Number(p.experiencia||0))*0.75);
    scoreParts.documentos=(p.documento_estado==='aprobado'||p.documento_licencia||p.hoja_vida_conductor)?6:0;
    scoreParts.camion=p.tipo==='Dueño de camión'?truckComplianceScore(p.trucks||[]):0;
    const score=Math.max(0,Object.values(scoreParts).reduce((a,b)=>a+Number(b||0),0));
    return {...p,match_score:Math.round(score),match_reasons:matchReasons(p,{company,jobs,saved},scoreParts),score_breakdown:scoreParts};
  }).sort((a,b)=>b.match_score-a.match_score || Number(b.verificado)-Number(a.verificado) || Number(b.reputation_rating||0)-Number(a.reputation_rating||0)).slice(0,Number(opts.limit||15));
  await trackEvent('smart_match_run',{company_id:companyId,metadata:{job_id:opts.job_id||null,results:ranked.length,top_score:ranked[0]?.match_score||0}});
  return ranked;
}


async function trackEvent(type,{company_id=null,profile_id=null,target_type='',target_id=null,metadata={}}={}){ await query('INSERT INTO events(type,company_id,profile_id,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[type,company_id,profile_id,target_type,target_id,JSON.stringify(metadata||{})]); return {ok:true}; }
async function analyticsSummary(companyId){ const rows=await query('SELECT type,COUNT(*) total FROM events WHERE company_id=$1 GROUP BY type',[companyId]); const byType={}; rows.forEach(r=>byType[r.type]=Number(r.total)); const recent=await query('SELECT * FROM events WHERE company_id=$1 ORDER BY id DESC LIMIT 20',[companyId]); return {byType,recent}; }
async function favoriteProfile(companyId,profileId){ try{ await query('INSERT INTO favorites(company_id,profile_id) VALUES($1,$2)',[companyId,profileId]); }catch(e){} await trackEvent('favorite_profile',{company_id:companyId,target_type:'profile',target_id:profileId}); return {ok:true}; }
async function removeFavorite(companyId,profileId){ await query('DELETE FROM favorites WHERE company_id=$1 AND profile_id=$2',[companyId,profileId]); return {ok:true}; }
async function listFavorites(companyId,company=null){ const rows=await query(`SELECT p.*,f.created_at,COALESCE(AVG(r.rating),0) reputation_rating,COUNT(r.id) reviews_count FROM favorites f JOIN profiles p ON p.id=f.profile_id LEFT JOIN reviews r ON r.target_type='profile' AND r.target_id=p.id WHERE f.company_id=$1 GROUP BY p.id,f.id,f.created_at ORDER BY f.id DESC`,[companyId]); const trucks=await query('SELECT * FROM trucks ORDER BY id'); return rows.map(p=>visibleProfile({...p,trucks:trucks.filter(t=>Number(t.profile_id)===Number(p.id))},company||{id:companyId})); }
async function addContactHistory(companyId,profileId,channel='whatsapp'){ try{ await query('INSERT INTO contact_history(company_id,profile_id,channel) VALUES($1,$2,$3)',[companyId,profileId,channel]); }catch(e){} await createNotification('profile',profileId,'Una empresa vio tu contacto','Una empresa registrada abrió tu contacto en ChoferLink.'); await trackEvent('contact_unlocked',{company_id:companyId,target_type:'profile',target_id:profileId,metadata:{channel}}); return {ok:true}; }
async function listContactHistory(companyId){ return query(`SELECT h.*,p.nombre,p.tipo,p.region,p.comuna,p.licencia,p.whatsapp,p.email FROM contact_history h LEFT JOIN profiles p ON p.id=h.profile_id WHERE h.company_id=$1 ORDER BY h.id DESC`,[companyId]); }
async function createNotification(userType,userId,title,message){ if(!userId) return null; const r=await query('INSERT INTO notifications(user_type,user_id,title,message) VALUES($1,$2,$3,$4) RETURNING id',[userType,userId,title,message]); return r[0]; }
async function listNotifications(userType,userId){ return query('SELECT * FROM notifications WHERE user_type=$1 AND user_id=$2 ORDER BY id DESC LIMIT 30',[userType,userId]); }
async function markNotificationsRead(userType,userId){ await query('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_type=$1 AND user_id=$2 AND read_at IS NULL',[userType,userId]); return {ok:true}; }



async function ensureRichDemoData(){
  const password='demo123';
  const regions=[
    ['Región Metropolitana','Santiago'],['Región Metropolitana','Pudahuel'],['Región Metropolitana','Maipú'],
    ['Valparaíso','San Antonio'],['Valparaíso','Valparaíso'],['Antofagasta','Calama'],['Antofagasta','Antofagasta'],
    ['Biobío','Concepción'],['Maule','Talca'],['Los Lagos','Puerto Montt']
  ];
  const nombres=['Juan González','Pedro Muñoz','Luis Rojas','Carlos Díaz','Diego Pérez','Andrés Soto','Felipe Contreras','Jorge Silva','Matías Martínez','Sebastián Sepúlveda','Rodrigo Fuentes','Ignacio Morales','Cristian Vargas','Héctor Araya','Víctor Carrasco','Pablo Navarro','Francisco Peña','Mauricio Godoy','Esteban Figueroa','Tomás Salinas'];
  const choferSpecs=['Carga pesada','Rutas nacionales','Minería / faena','Puerto y contenedores','Retail y distribución','Carga refrigerada','Carga peligrosa','Forestales','Última milla','Rampla y batea'];
  const peonetaSpecs=['Carga y descarga','Reparto urbano','Retail supermercados','Mudanzas','Bodega y picking','Apoyo ruta larga','Última milla','Manipulación cuidadosa','Peoneta nocturno','Apoyo frigorífico'];
  const ownerSpecs=['Rampla nacional','Tolva minera','Frigorífico','Camión 3/4 reparto','Camión pluma','Portacontenedores','Aljibe','Carga seca','Furgón cerrado','Cama baja'];
  const licencias=['A2','A3','A4','A5'];
  const availability=['Disponible hoy','Disponible ahora','Disponible en 48 horas','Disponible esta semana','Turnos por confirmar'];
  const truckTypes=['Rampla','Tolva','Frigorífico','Camión 3/4','Camión pluma','Portacontenedor','Aljibe','Furgón cerrado','Cama baja','Caja seca'];
  async function profileExists(email){ return (await query('SELECT id FROM profiles WHERE LOWER(email)=LOWER($1)',[email]))[0]; }
  async function safeCreateProfile(data){ if(await profileExists(data.email)) return; try{ await createProfile(data); }catch(e){ /* demo idempotente */ } }
  async function fillRole(tipo,count,build){
    const existing=Number((await query('SELECT COUNT(*) total FROM profiles WHERE tipo=$1',[tipo]))[0].total||0);
    for(let i=existing+1;i<=count;i++) await safeCreateProfile(build(i));
  }
  await fillRole('Chofer',20,i=>{ const rc=regions[(i-1)%regions.length]; const licencia=licencias[(i-1)%licencias.length]; const nombre=nombres[(i-1)%nombres.length]; return {tipo:'Chofer',nombre:`${nombre} ${i}`,rut:'',region:rc[0],comuna:rc[1],licencia,experiencia:2+(i%18),especialidad:choferSpecs[(i-1)%choferSpecs.length],disponibilidad:availability[(i-1)%availability.length],verificado:i%3!==0,email:`chofer${i}@test.cl`,whatsapp:`+56 9 70${String(i).padStart(2,'0')} ${String(1000+i).slice(-4)}`,rutas:i%2?'Nacional':'Urbano / regional',descripcion:`Chofer demo ${licencia} para probar filtros, postulaciones y matching automático.`,documento_licencia:'/uploads/drivers/demo-licencia.pdf',hoja_vida_conductor:'/uploads/drivers/demo-hoja.pdf',licencia_vencimiento:'2027-12-31',documento_estado:i%4===0?'pendiente':'aprobado',password}; });
  await fillRole('Peoneta',20,i=>{ const rc=regions[(i+2)%regions.length]; const nombre=nombres[(i+3)%nombres.length]; return {tipo:'Peoneta',nombre:`${nombre} Peoneta ${i}`,rut:'',region:rc[0],comuna:rc[1],licencia:'',experiencia:1+(i%10),especialidad:peonetaSpecs[(i-1)%peonetaSpecs.length],disponibilidad:availability[(i+1)%availability.length],verificado:i%4!==0,email:`peoneta${i}@test.cl`,whatsapp:`+56 9 71${String(i).padStart(2,'0')} ${String(2000+i).slice(-4)}`,rutas:i%2?'Reparto urbano':'Bodega y ruta',descripcion:'Peoneta demo para probar búsqueda, disponibilidad y postulaciones.',documento_licencia:'',hoja_vida_conductor:'/uploads/drivers/demo-cv.pdf',documento_estado:i%5===0?'pendiente':'aprobado',password}; });
  await fillRole('Dueño de camión',20,i=>{ const rc=regions[(i+5)%regions.length]; const nombre=nombres[(i+6)%nombres.length]; const tipoCamion=truckTypes[(i-1)%truckTypes.length]; return {tipo:'Dueño de camión',nombre:`${nombre} Camiones ${i}`,rut:'',region:rc[0],comuna:rc[1],licencia:'',experiencia:3+(i%20),especialidad:ownerSpecs[(i-1)%ownerSpecs.length],disponibilidad:availability[(i+2)%availability.length],verificado:i%3!==1,email:`dueno${i}@test.cl`,whatsapp:`+56 9 72${String(i).padStart(2,'0')} ${String(3000+i).slice(-4)}`,rutas:i%2?'Zona centro norte':'Zona sur / puertos',descripcion:'Dueño de camión demo con documentación vehicular para matching.',password,trucks:[{patente:`CL${String(i).padStart(2,'0')}-${String(100+i).slice(-2)}`,tipo:tipoCamion,marca_modelo:i%2?'Volvo FH':'Scania R',anio:2017+(i%8),capacidad_toneladas:String(8+(i%24)),seguro_vigente:'Sí',revision_tecnica:i%5===0?'No':'Sí',permiso_circulacion:'Sí',soap:'Sí',disponibilidad:availability[(i+2)%availability.length]}]}; });

  const companies=[
    {nombre:'Ruta Norte Express',razon_social:'Ruta Norte Express SpA',rut_empresa:'',region:'Antofagasta',comuna:'Calama',tipo_empresa:'Minería',necesidad:'Choferes A5 con experiencia minera y disponibilidad inmediata',email:'rrhh@rutanorte.test',whatsapp:'+56 9 8100 1001',password,plan:'pro',verificada:1,rating:4.7,tamano_empresa:'Grande',descripcion:'Operación minera con rutas Calama, Antofagasta y faena.'},
    {nombre:'Puerto San Antonio Cargo',razon_social:'Puerto San Antonio Cargo Ltda.',rut_empresa:'',region:'Valparaíso',comuna:'San Antonio',tipo_empresa:'Puerto / Contenedores',necesidad:'Dueños de camión y choferes para contenedores y rampla',email:'operaciones@puertosanantonio.test',whatsapp:'+56 9 8100 1002',password,plan:'premium',verificada:1,rating:4.9,tamano_empresa:'Mediana',descripcion:'Carga portuaria, contenedores y transferencia a centros de distribución.'},
    {nombre:'Frío Sur Logística',razon_social:'Frío Sur Logística SpA',rut_empresa:'',region:'Los Lagos',comuna:'Puerto Montt',tipo_empresa:'Refrigerado',necesidad:'Choferes A4/A5 y camiones frigoríficos',email:'talento@friosur.test',whatsapp:'+56 9 8100 1003',password,plan:'pro',verificada:1,rating:4.6,tamano_empresa:'Mediana',descripcion:'Transporte refrigerado para alimentos y salmones.'},
    {nombre:'Retail Última Milla',razon_social:'Retail Última Milla SpA',rut_empresa:'',region:'Región Metropolitana',comuna:'Pudahuel',tipo_empresa:'Retail',necesidad:'Peonetas y choferes A2/A4 para reparto urbano',email:'personas@ultimamilla.test',whatsapp:'+56 9 8100 1004',password,plan:'free',verificada:0,rating:4.1,tamano_empresa:'Grande',descripcion:'Distribución urbana y e-commerce.'},
    {nombre:'Agro Maule Transporte',razon_social:'Agro Maule Transporte Ltda.',rut_empresa:'',region:'Maule',comuna:'Talca',tipo_empresa:'Agrícola',necesidad:'Camiones para carga seca y temporeros de apoyo ruta',email:'contacto@agromaule.test',whatsapp:'+56 9 8100 1005',password,plan:'pro',verificada:1,rating:4.4,tamano_empresa:'Pequeña',descripcion:'Transporte agrícola y distribución regional.'}
  ];
  for(const c of companies){ const ex=await query('SELECT id FROM companies WHERE LOWER(email)=LOWER($1)',[c.email]); if(!ex[0]) await createCompany(c); }

  async function companyByEmail(email){ return (await query('SELECT * FROM companies WHERE LOWER(email)=LOWER($1)',[email]))[0]; }
  async function profileByEmail(email){ return (await query('SELECT * FROM profiles WHERE LOWER(email)=LOWER($1)',[email]))[0]; }
  async function ensureJob(company,emailTitle,j){ const c=await companyByEmail(company); if(!c) return null; const ex=(await query('SELECT * FROM jobs WHERE company_id=$1 AND titulo=$2',[c.id,emailTitle]))[0]; if(ex) return ex; return createJob(c.id,{...j,titulo:emailTitle}); }
  async function ensureApplication(job,profileEmail,status,mensaje){ if(!job) return null; const p=await profileByEmail(profileEmail); if(!p) return null; const ex=(await query('SELECT * FROM applications WHERE job_id=$1 AND profile_id=$2',[job.id,p.id]))[0]; if(ex){ await query('UPDATE applications SET status=$1 WHERE id=$2',[status,ex.id]); return {...ex,status}; } const r=await query('INSERT INTO applications(job_id,profile_id,nombre,email,whatsapp,mensaje,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[job.id,p.id,p.nombre,p.email||'',p.whatsapp,mensaje,status]); return (await query('SELECT * FROM applications WHERE id=$1',[r[0].id]))[0]; }
  async function safeReviewProfile(companyId,profileId,applicationId,rating,comment){ try{ await createProfileReview(companyId,profileId,{application_id:applicationId,rating,criterio_1:rating,criterio_2:Math.max(4,rating-1),criterio_3:rating,comment}); }catch(e){} }
  async function safeReviewCompany(profileId,companyId,applicationId,rating,comment){ try{ await createCompanyReview(profileId,companyId,{application_id:applicationId,rating,criterio_1:rating,criterio_2:rating,criterio_3:Math.max(4,rating-1),comment}); }catch(e){} }

  const scenarios=[
    {company:'rrhh@rutanorte.test',title:'Chofer A5 para faena minera Calama',job:{region:'Antofagasta',comuna:'Calama',ubicacion:'Calama, Antofagasta',licencia:'A5',salario:'CLP $1.800.000 a convenir',descripcion:'Matching demo: prioriza A5, experiencia minera, disponibilidad inmediata y región Antofagasta.'},apps:[['chofer3@test.cl','contratado','Match automático: A5, faena minera y misma región.'],['chofer7@test.cl','entrevista','Compatibilidad alta por licencia y experiencia.'],['chofer11@test.cl','contactado','Disponible esta semana para faena.']]},
    {company:'operaciones@puertosanantonio.test',title:'Dueño de camión para contenedores San Antonio',job:{region:'Valparaíso',comuna:'San Antonio',ubicacion:'Puerto San Antonio',licencia:'A5',salario:'Por viaje / contrato mensual',descripcion:'Matching demo: prioriza puerto, contenedores, rampla y documentación vehicular.'},apps:[['dueno4@test.cl','contratado','Camión compatible para operación portuaria.'],['dueno14@test.cl','contactado','Rampla disponible para puerto.'],['chofer4@test.cl','entrevista','Chofer con experiencia portuaria.']]},
    {company:'personas@ultimamilla.test',title:'Peonetas para reparto urbano RM',job:{region:'Región Metropolitana',comuna:'Pudahuel',ubicacion:'Pudahuel, RM',licencia:'A2',salario:'CLP $750.000 líquido aprox.',descripcion:'Matching demo: peonetas y choferes para reparto urbano, carga y descarga.'},apps:[['peoneta1@test.cl','contratado','Experiencia en última milla y disponibilidad rápida.'],['peoneta8@test.cl','contactado','Buen match por comuna cercana.'],['chofer1@test.cl','entrevista','Chofer disponible para reparto urbano.']]}
  ];
  for(const sc of scenarios){
    const c=await companyByEmail(sc.company); const job=await ensureJob(sc.company,sc.title,sc.job); if(!c||!job) continue;
    await saveSearch(c.id,{nombre:`Demo: ${sc.title}`,tipo:'todos',licencia:sc.job.licencia,q:sc.job.descripcion,region:sc.job.region}).catch(()=>{});
    for(const [email,status,msg] of sc.apps){ const app=await ensureApplication(job,email,status,msg); const p=await profileByEmail(email); if(p){ await favoriteProfile(c.id,p.id); await addContactHistory(c.id,p.id,'whatsapp'); if(app&&['contactado','entrevista','contratado','cerrado'].includes(status)){ await safeReviewProfile(c.id,p.id,app.id,status==='contratado'?5:4,`Evaluación demo: ${msg}`); await safeReviewCompany(p.id,c.id,app.id,status==='contratado'?5:4,'Empresa demo con flujo de contratación claro y comunicación rápida.'); } } }
  }
}

async function seedIfEmpty(){
  if(Number((await query('SELECT COUNT(*) total FROM profiles'))[0].total)===0){
    await createProfile({tipo:'Chofer',nombre:'Juan Martínez',rut:'12.345.678-5',region:'Región Metropolitana',comuna:'Santiago',licencia:'A5',experiencia:12,especialidad:'Carga pesada',disponibilidad:'Disponible hoy',verificado:1,email:'juan@example.cl',whatsapp:'+56 9 9999 1000',rutas:'Nacional',descripcion:'Experiencia en rutas Santiago, Antofagasta y puertos.'});
    await createProfile({tipo:'Chofer',nombre:'Carlos Rivas',rut:'13.456.789-6',region:'Antofagasta',comuna:'Calama',licencia:'A5',experiencia:8,especialidad:'Minería',disponibilidad:'Disponible esta semana',verificado:1,email:'carlos@example.cl',whatsapp:'+56 9 5555 2200',rutas:'Zona norte'});
    await createProfile({tipo:'Peoneta',nombre:'Miguel Torres',rut:'15.234.567-8',region:'Región Metropolitana',comuna:'Maipú',licencia:'',experiencia:4,especialidad:'Carga y descarga',disponibilidad:'Disponible hoy',verificado:1,email:'miguel@example.cl',whatsapp:'+56 9 4444 3300',rutas:'Urbano',descripcion:'Ayudante de ruta con experiencia en reparto, carga y descarga.'});
    await createProfile({tipo:'Dueño de camión',nombre:'Transportes Andes SpA',rut:'76.123.456-7',region:'Valparaíso',comuna:'San Antonio',licencia:'',experiencia:15,especialidad:'Puerto / contenedores',disponibilidad:'Camión disponible',verificado:1,email:'andes@example.cl',whatsapp:'+56 9 7777 8888',trucks:[{patente:'ABCD-12',tipo:'Rampla',marca_modelo:'Volvo FH',anio:2020,capacidad_toneladas:'28',seguro_vigente:'Sí',revision_tecnica:'Sí',permiso_circulacion:'Sí',soap:'Sí',disponibilidad:'Disponible ahora'}]});
  }
  const peonetaExists=await query("SELECT id FROM profiles WHERE tipo='Peoneta' LIMIT 1");
  if(!peonetaExists[0]) await createProfile({tipo:'Peoneta',nombre:'Miguel Torres',rut:'15.234.567-8',region:'Región Metropolitana',comuna:'Maipú',licencia:'',experiencia:4,especialidad:'Carga y descarga',disponibilidad:'Disponible hoy',verificado:1,email:'miguel@example.cl',whatsapp:'+56 9 4444 3300',rutas:'Urbano',descripcion:'Ayudante de ruta con experiencia en reparto, carga y descarga.'});
  const demos=[{nombre:'TransLog',razon_social:'TransLog SpA',rut_empresa:'76.987.654-3',region:'Región Metropolitana',comuna:'Pudahuel',tipo_empresa:'Logística',necesidad:'Choferes A5 para rutas nacionales',email:'rrhh@translog.example',whatsapp:'+56 9 8888 1000',password:'demo123',plan:'pro',verificada:1,rating:4.8,tamano_empresa:'Mediana',sitio_web:'https://example.cl',descripcion:'Operador logístico para rutas nacionales, última milla y carga B2B.'},{nombre:'Minera Norte Servicios',razon_social:'Minera Norte Servicios SpA',rut_empresa:'77.222.333-4',region:'Antofagasta',comuna:'Calama',tipo_empresa:'Minería',necesidad:'Choferes A5 para faena minera',email:'contrataciones@mineranorte.example',whatsapp:'+56 9 3410 2211',password:'demo123',plan:'free',verificada:0,rating:4.3,tamano_empresa:'Grande',descripcion:'Servicios para faenas mineras en la zona norte.'}];
  for(const c of demos){ const ex=await query('SELECT id,password_hash FROM companies WHERE LOWER(email)=LOWER($1)',[c.email]); if(!ex[0]) await createCompany(c); else if(!ex[0].password_hash?.includes(':')) await query('UPDATE companies SET password_hash=$1 WHERE id=$2',[hpw(c.password),ex[0].id]); }
  if(Number((await query('SELECT COUNT(*) total FROM jobs'))[0].total)===0){ const cs=await query('SELECT id FROM companies ORDER BY id LIMIT 2'); if(cs[0]) await createJob(cs[0].id,{titulo:'Chofer A5 Santiago - Antofagasta',region:'Región Metropolitana',comuna:'Pudahuel',licencia:'A5',salario:'CLP $1.400.000 líquido aprox.',descripcion:'Experiencia en articulados y documentación al día.',max_applications:8}); if(cs[1]) await createJob(cs[1].id,{titulo:'Chofer A5 para faena minera',region:'Antofagasta',comuna:'Calama',licencia:'A5',salario:'CLP $1.800.000 a convenir',descripcion:'Turnos, experiencia minera y disponibilidad inmediata.',max_applications:5}); }
  if(Number((await query('SELECT COUNT(*) total FROM reviews'))[0].total)===0){
    const p=await query('SELECT id FROM profiles ORDER BY id LIMIT 3'), c=await query('SELECT id FROM companies ORDER BY id LIMIT 2');
    const jobs=await query('SELECT j.*,c.id company_id FROM jobs j JOIN companies c ON c.id=j.company_id ORDER BY j.id LIMIT 3');
    async function demoApp(job,profile){ if(!job||!profile) return null; const existing=(await query('SELECT id FROM applications WHERE job_id=$1 AND profile_id=$2',[job.id,profile.id]))[0]; if(existing){ await query("UPDATE applications SET status='contratado' WHERE id=$1",[existing.id]); return existing; } const prof=(await query('SELECT * FROM profiles WHERE id=$1',[profile.id]))[0]; const r=await query("INSERT INTO applications(job_id,profile_id,nombre,email,whatsapp,mensaje,status) VALUES($1,$2,$3,$4,$5,$6,'contratado') RETURNING id",[job.id,profile.id,prof.nombre,prof.email||'',prof.whatsapp,'Relación demo para evaluación verificada']); return r[0]; }
    const a1=await demoApp(jobs[0],p[0]); const a2=await demoApp(jobs[0],p[1]); const a3=await demoApp(jobs[1]||jobs[0],p[2]);
    if(c[0]&&p[0]&&a1) await createProfileReview(c[0].id,p[0].id,{application_id:a1.id,rating:5,criterio_1:5,criterio_2:5,criterio_3:5,comment:'Muy responsable, documentación al día y excelente comunicación.'});
    if(c[0]&&p[1]&&a2) await createProfileReview(c[0].id,p[1].id,{application_id:a2.id,rating:4,criterio_1:4,criterio_2:5,criterio_3:4,comment:'Buen desempeño para rutas del norte y faenas.'});
    if(c[1]&&p[2]&&a3) await createProfileReview(c[1].id,p[2].id,{application_id:a3.id,rating:5,criterio_1:5,criterio_2:4,criterio_3:5,comment:'Camión en buen estado, patente y permisos vigentes.'});
    if(c[0]&&p[0]&&a1) await createCompanyReview(p[0].id,c[0].id,{application_id:a1.id,rating:5,criterio_1:5,criterio_2:5,criterio_3:4,comment:'Pagaron a tiempo y el trato fue profesional.'});
    if(c[1]&&p[2]&&a3) await createCompanyReview(p[2].id,c[1].id,{application_id:a3.id,rating:4,criterio_1:4,criterio_2:4,criterio_3:5,comment:'Buenas condiciones de faena y comunicación clara.'});
  }
  await ensureRichDemoData();
}
module.exports={client,createPasswordReset,resetPasswordByToken,adminAuditEvents,fraudSignals,createEmailVerification,verifyEmailToken,getEmailVerificationTarget,isValidRut,formatRut,normalizeCompanyRut,BUSINESS_RULES,businessPermissions,planActive,canCompanyUnlockContacts,canCompanyPublishJobs,canCompanySaveSearches,canCompanyMoveApplicationTo,companyJobAllowance,activateCompanyPaid,activateCompanyPaidByEmail,migrate,seedIfEmpty,stats,adminSummary,adminListCompanies,adminListProfiles,adminListJobs,adminListApplications,adminUpdateProfileVerification,adminUpdateCompanyVerification,adminDeleteCompany,adminDeleteProfile,adminGetCompanyDocument,adminGetProfileDocument,listPendingDocuments,createProfile,listProfiles,recommendProfilesForCompany,createCompany,listCompanies,loginCompany,getCompanyByToken,getProfileByToken,loginProfile,getProfileDashboard,updateProfile,updateProfileAvailability,changeProfilePassword,deleteProfileAccount,companySubscriptionStatus,createPaymentAttempt,getPaymentByFlowToken,updatePaymentFromFlow,activateCompanyPaidFromPayment,listCompanyPayments,updateCompanyPlan,cancelCompanyPlan,getCompanyPublicById,getCompanyPublicPage,updateCompanyProfile,companyMetrics,saveSearch,listSavedSearches,deleteSavedSearch,createJob,listCompanyJobs,updateCompanyJob,updateCompanyJobStatus,deleteCompanyJob,getJobById,listJobs,applyToJob,listApplicationsForCompany,listApplicationsForProfile,updateApplicationStatus,withdrawApplication,canCompanyReviewProfile,canProfileReviewCompany,createProfileReview,createCompanyReview,listReviews,reputationSummary,trackEvent,analyticsSummary,favoriteProfile,removeFavorite,listFavorites,addContactHistory,listContactHistory,listNotifications,markNotificationsRead,createNotification};
