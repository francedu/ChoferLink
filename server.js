try { require('dotenv').config(); } catch (_) { /* .env opcional */ }
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');
const app = express();
const port = process.env.PORT || 3000;
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
for (const method of ['get','post','put','patch','delete']) {
  const original = app[method].bind(app);
  app[method] = (path, ...handlers) => original(path, ...handlers.map(h => h && h.constructor && h.constructor.name === 'AsyncFunction' ? asyncRoute(h) : h));
}
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
if (isProduction && !allowedOrigins.length) {
  console.warn('CORS_ORIGINS no está configurado; solo se aceptarán requests sin Origin y del mismo sitio.');
}
app.use(cors({ origin: (origin, cb) => {
  if (!origin) return cb(null, true);
  if (!allowedOrigins.length) return cb(null, !isProduction);
  return cb(null, allowedOrigins.includes(origin));
}}));
app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Permissions-Policy','geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});
app.use(express.json({limit:'250kb'})); app.use(express.urlencoded({extended:true,limit:'250kb'}));
app.use('/uploads', (_req,res)=>res.status(403).json({error:'Documentos protegidos. Inicia sesión como empresa verificada para solicitarlos.'}));
// En producción no se sirve el directorio raíz completo. Solo archivos públicos explícitos.
app.use('/assets', express.static(path.join(__dirname,'assets'), { dotfiles:'ignore', immutable:true, maxAge:'7d' }));
app.get('/styles.css', (_req,res)=>res.sendFile(path.join(__dirname,'styles.css')));
app.get('/app.js', (_req,res)=>res.sendFile(path.join(__dirname,'app.js')));
const uploadDir = path.join(__dirname, 'uploads', 'drivers');
fs.mkdirSync(uploadDir, { recursive: true });
const MAX_DOC_SIZE_MB = 2;
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safe}`);
  }
});
const uploadDriverDocs = multer({
  storage,
  limits: { fileSize: MAX_DOC_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const okByField = file.fieldname === 'licencia_archivo'
      ? ['application/pdf','image/jpeg','image/png'].includes(file.mimetype)
      : file.fieldname === 'hoja_vida_archivo'
        ? file.mimetype === 'application/pdf'
        : true;
    if (!okByField) return cb(new Error('Formato no permitido. Licencia: PDF/JPG/PNG. Hoja de vida: PDF.'));
    cb(null, true);
  }
});
function uploadErrorHandler(err, _req, res, next){
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({error:`Cada archivo debe pesar máximo ${MAX_DOC_SIZE_MB} MB.`});
  return res.status(400).json({error:err.message || 'No se pudo subir el archivo.'});
}
function isAllowedUploadedFile(file){
  if (!file || !file.path) return false;
  const buf = fs.readFileSync(file.path);
  const isPdf = buf.length > 4 && buf.slice(0,4).toString() === '%PDF';
  const isPng = buf.length > 8 && buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4e && buf[3]===0x47 && buf[4]===0x0d && buf[5]===0x0a && buf[6]===0x1a && buf[7]===0x0a;
  const isJpg = buf.length > 3 && buf[0]===0xff && buf[1]===0xd8 && buf[buf.length-2]===0xff && buf[buf.length-1]===0xd9;
  if (file.fieldname === 'hoja_vida_archivo') return file.mimetype === 'application/pdf' && isPdf;
  if (file.fieldname === 'licencia_archivo') return (file.mimetype === 'application/pdf' && isPdf) || (file.mimetype === 'image/png' && isPng) || (file.mimetype === 'image/jpeg' && isJpg);
  return false;
}
function attachUploadedDriverDocs(req){
  for (const list of Object.values(req.files || {})) for (const file of list || []) {
    if (!isAllowedUploadedFile(file)) { try { fs.unlinkSync(file.path); } catch (_) {} throw new Error('Archivo rechazado: el contenido no coincide con el formato permitido.'); }
  }
  const files = req.files || {};
  const rel = f => f ? `/uploads/drivers/${f.filename}` : '';
  if (files.licencia_archivo?.[0]) req.body.documento_licencia = rel(files.licencia_archivo[0]);
  if (files.hoja_vida_archivo?.[0]) req.body.hoja_vida_conductor = rel(files.hoja_vida_archivo[0]);
  if (req.body.documento_licencia || req.body.hoja_vida_conductor || req.body.licencia_vencimiento) {
    req.body.documento_estado = 'pendiente';
  }
}

const companyRouteFiles = {
  '/empresa/perfiles': 'empresa-perfiles.html',
  '/empresa/trabajos': 'empresa-trabajos.html',
  '/empresa/empresas': 'empresa-empresas.html',
  '/empresa/matches': 'empresa-matches.html',
  '/empresa/postulaciones': 'empresa-postulaciones.html',
  '/empresa/suscripcion': 'empresa-suscripcion.html'
};
// Rutas amigables para evitar enlaces rotos en local y Render
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/inicio', (req,res)=>res.redirect('/'));
app.get('/empresa', (req,res)=>res.sendFile(path.join(__dirname,'empresa.html')));
app.get('/registro', (req,res)=>res.sendFile(path.join(__dirname,'registro.html')));
app.get('/admin', (req,res)=>res.sendFile(path.join(__dirname,'admin.html')));
app.get('/perfil', (req,res)=>res.sendFile(path.join(__dirname,'perfil.html')));
app.get('/buscar', (req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/trabajos/:id', (req,res)=>res.sendFile(path.join(__dirname,'index.html')));

Object.entries(companyRouteFiles).forEach(([route, file]) => {
  app.get(route, (req,res)=>res.sendFile(path.join(__dirname,file)));
});
app.get('/empresa-publica/:id', (req,res)=>res.sendFile(path.join(__dirname,'empresa-publica.html')));
function bearer(req){ return (req.headers.authorization||'').replace('Bearer ',''); }
async function requireCompany(req,res,next){ const c=await db.getCompanyByToken(bearer(req)); if(!c) return res.status(401).json({error:'Debes iniciar sesión como empresa.'}); req.company=c; next(); }
async function requireProfile(req,res,next){ const p=await db.getProfileByToken((req.headers['x-profile-token']||'').toString() || bearer(req)); if(!p) return res.status(401).json({error:'Debes iniciar sesión con un perfil registrado para postular.'}); req.profile=p; next(); }
function requireCompanyProfileComplete(req,res,next){ const required=['nombre','rut_empresa','region','comuna','tipo_empresa','whatsapp']; const missing=required.filter(f=>!req.company || !req.company[f]); if(missing.length) return res.status(403).json({error:'Completa y guarda el perfil de empresa antes de publicar ofertas.'}); next(); }
async function requireJobQuota(req,res,next){ const allowance=await db.companyJobAllowance(req.company.id); if(!allowance.can_create) return res.status(402).json({error:allowance.reason || 'Tu plan Free permite una oferta abierta a la vez. Activa Pagado para publicar más ofertas.', code:'job_limit_reached', allowance}); req.jobAllowance=allowance; next(); }
function requirePaidCompany(req,res,next){ if(!db.canCompanySaveSearches(req.company)) return res.status(402).json({error:'Esta función requiere el plan Pagado de 0,5 UF mensuales. Puedes activarlo desde tu panel; si cancelas, se respeta el período de 30 días ya contratado.'}); next(); }
function requireVerifiedCompany(req,res,next){ if(!req.company?.verificada) return res.status(403).json({error:'Tu empresa debe estar verificada para usar esta función. Completa el perfil de empresa y espera la aprobación documental.'}); next(); }
function requireContactAccess(req,res,next){ if(!db.canCompanyUnlockContacts(req.company)) return res.status(req.company?.verificada?402:403).json({error:req.company?.verificada?'Para desbloquear datos de contacto, favoritos y contacto por WhatsApp necesitas el plan Pagado activo.':'Tu empresa debe estar verificada para desbloquear datos de contacto.'}); next(); }
function maskApplicationContacts(app,reason='locked'){ return {...app,email:reason==='verification_required'?'Protegido hasta verificar empresa':'Protegido por plan Free',whatsapp:reason==='verification_required'?'Protegido hasta verificar empresa':'Protegido por plan Free',contact_locked:true,contact_lock_reason:reason}; }

function isDemoBillingEnabled(){
  const mode = String(process.env.BILLING_MODE || '').toLowerCase();
  const explicit = String(process.env.ALLOW_DEMO_BILLING || '').toLowerCase();
  if (mode === 'demo' || explicit === 'true') return true;
  if (mode === 'manual' || mode === 'payment') return false;
  return String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
}
function paymentRequiredPayload(){
  return {
    error: 'Para activar el plan Pagado debes completar el pago de 0,5 UF. La activación directa de demo está deshabilitada en producción.',
    code: 'payment_required',
    checkout_url: process.env.PAYMENT_CHECKOUT_URL || null,
    instructions: 'Configura PAYMENT_CHECKOUT_URL con la pasarela real o habilita BILLING_MODE=demo solo en desarrollo.'
  };
}

const adminSessions = new Map();
const ADMIN_SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS || 8*60*60*1000);
function makeAdminSession(){ return crypto.randomBytes(32).toString('hex'); }
function getAdminAuth(req){ return (req.headers.authorization||'').replace('Bearer ','') || req.headers['x-admin-session'] || ''; }
function timingSafeEq(a,b){ const A=Buffer.from(String(a||'')); const B=Buffer.from(String(b||'')); return A.length===B.length && crypto.timingSafeEqual(A,B); }
function requireAdmin(req,res,next){
  const session=getAdminAuth(req);
  const stored=session && adminSessions.get(session);
  if(stored && Date.now()-stored.created_at <= ADMIN_SESSION_TTL_MS) return next();
  if(session) adminSessions.delete(session);
  const adminToken=process.env.ADMIN_TOKEN;
  const provided=String(req.headers['x-admin-token']||'');
  if(adminToken && timingSafeEq(provided,adminToken)) return next();
  return res.status(401).json({error:'Administrador no autorizado.'});
}
const buckets = new Map();
function rateLimit(name, max, windowMs){ return (req,res,next)=>{ const key = `${name}:${req.ip}`; const now = Date.now(); const b = buckets.get(key) || {count:0,reset:now+windowMs}; if(now>b.reset){ b.count=0; b.reset=now+windowMs; } b.count += 1; buckets.set(key,b); if(b.count>max) return res.status(429).json({error:'Demasiados intentos. Prueba nuevamente en unos minutos.'}); next(); }; }
function isEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'')); }
function onlyDigits(v){ return String(v||'').replace(/\D/g,''); }
function isPhoneCL(v){ const d=onlyDigits(v); return d.length>=9 && d.length<=12; }
function clean(v,max=500){ return String(v||'').trim().replace(/[\u0000-\u001F\u007F]/g,'').slice(0,max); }
function validateRut(rut){ const value=String(rut||'').replace(/\./g,'').replace(/-/g,'').toUpperCase(); if(!/^\d{7,8}[0-9K]$/.test(value)) return false; const body=value.slice(0,-1), dv=value.slice(-1); let sum=0,m=2; for(let i=body.length-1;i>=0;i--){ sum += Number(body[i])*m; m = m===7 ? 2 : m+1; } const calc=11-(sum%11); const expected=calc===11?'0':calc===10?'K':String(calc); return dv===expected; }
function normalizeBody(body){ for(const k of Object.keys(body||{})){ if(typeof body[k]==='string') body[k]=clean(body[k], k==='descripcion'||k==='comment'||k==='mensaje'?800:180); } return body; }
function validateProfilePayload(b){ normalizeBody(b); if(b.rut && !validateRut(b.rut)) return 'RUT inválido. Usa un formato válido, ej: 12.345.678-5.'; if(b.email && !isEmail(b.email)) return 'Email inválido.'; if(b.whatsapp && !isPhoneCL(b.whatsapp)) return 'WhatsApp inválido. Usa un número válido, ej: +56 9 1234 5678.'; if(b.licencia && !['A2','A3','A4','A5',''].includes(b.licencia)) return 'Licencia inválida.'; for(const t of (b.trucks||[])){ t.patente=clean(t.patente,12).toUpperCase(); if(t.patente && !/^[A-Z]{2,4}[- ]?[0-9]{2,4}$/.test(t.patente)) return `Patente inválida: ${t.patente}`; } return null; }
function validateCompanyPayload(b){ normalizeBody(b); if(b.rut_empresa && !validateRut(b.rut_empresa)) return 'RUT empresa inválido.'; if(b.email && !isEmail(b.email)) return 'Email inválido.'; if(b.whatsapp && !isPhoneCL(b.whatsapp)) return 'WhatsApp inválido.'; if(b.password && String(b.password).length<6) return 'La clave debe tener al menos 6 caracteres.'; return null; }
app.get('/api/health',(req,res)=>res.json({ok:true,database:db.client}));
app.get('/api/stats',async(req,res)=>res.json(await db.stats()));
app.get('/api/me',async(req,res)=>res.json({company:await db.getCompanyByToken(bearer(req)),profile:await db.getProfileByToken((req.headers['x-profile-token']||'').toString())}));
app.post('/api/profile-login',rateLimit('profileLogin',8,10*60*1000),async(req,res)=>{ const s=await db.loginProfile(req.body.email,req.body.password); if(!s) return res.status(401).json({error:'Email o contraseña incorrectos.'}); res.json(s); });
app.get('/api/business-rules',(_req,res)=>res.json(db.BUSINESS_RULES));
app.get('/api/company-subscription',requireCompany,async(req,res)=>res.json(await db.companySubscriptionStatus(req.company.id)));
app.get('/api/company-dashboard',requireCompany,async(req,res)=>{ const perms=db.businessPermissions(req.company); const applications=await db.listApplicationsForCompany(req.company.id); const lockReason=!req.company.verificada?'verification_required':'paid_plan_required'; res.json({company:req.company,permissions:perms,business_rules:db.BUSINESS_RULES,metrics:await db.companyMetrics(req.company.id),saved_searches:await db.listSavedSearches(req.company.id),applications:perms.can_unlock_contacts?applications:applications.map(a=>maskApplicationContacts(a,lockReason)),jobs:await db.listCompanyJobs(req.company.id),favorites:perms.can_save_favorites?await db.listFavorites(req.company.id,req.company):[],contact_history:perms.can_unlock_contacts?await db.listContactHistory(req.company.id):[],notifications:await db.listNotifications('company',req.company.id),analytics:await db.analyticsSummary(req.company.id)}); });
app.get('/api/recommendations',requireCompany,requireContactAccess,async(req,res)=>res.json({recommendations:await db.recommendProfilesForCompany(req.company.id,{region:req.query.region,licencia:req.query.licencia})}));

app.post('/api/events',async(req,res)=>{ const c=await db.getCompanyByToken(bearer(req)); const p=await db.getProfileByToken((req.headers['x-profile-token']||'').toString()); await db.trackEvent(clean(req.body.type||'frontend_event',60),{company_id:c?.id||null,profile_id:p?.id||null,target_type:clean(req.body.target_type||'',30),target_id:req.body.target_id||null,metadata:req.body.metadata||{}}); res.json({ok:true}); });
app.get('/api/favorites',requireCompany,requireContactAccess,async(req,res)=>res.json(await db.listFavorites(req.company.id,req.company)));
app.post('/api/favorites/:profileId',requireCompany,requireContactAccess,async(req,res)=>res.json(await db.favoriteProfile(req.company.id,req.params.profileId)));
app.delete('/api/favorites/:profileId',requireCompany,async(req,res)=>res.json(await db.removeFavorite(req.company.id,req.params.profileId)));
app.post('/api/contact-history/:profileId',requireCompany,requireContactAccess,async(req,res)=>res.json(await db.addContactHistory(req.company.id,req.params.profileId,req.body.channel||'whatsapp')));
app.get('/api/contact-history',requireCompany,requireContactAccess,async(req,res)=>res.json(await db.listContactHistory(req.company.id)));
app.get('/api/notifications',async(req,res)=>{ const c=await db.getCompanyByToken(bearer(req)); const p=await db.getProfileByToken((req.headers['x-profile-token']||'').toString()); if(c) return res.json(await db.listNotifications('company',c.id)); if(p) return res.json(await db.listNotifications('profile',p.id)); res.status(401).json({error:'Debes iniciar sesión.'}); });
app.post('/api/notifications/read',async(req,res)=>{ const c=await db.getCompanyByToken(bearer(req)); const p=await db.getProfileByToken((req.headers['x-profile-token']||'').toString()); if(c) return res.json(await db.markNotificationsRead('company',c.id)); if(p) return res.json(await db.markNotificationsRead('profile',p.id)); res.status(401).json({error:'Debes iniciar sesión.'}); });
app.get('/api/company-analytics',requireCompany,async(req,res)=>res.json(await db.analyticsSummary(req.company.id)));

app.put('/api/company-profile',requireCompany,async(req,res)=>{ try{ const bad=validateCompanyPayload(req.body); if(bad) return res.status(400).json({error:bad}); for(const f of ['nombre','rut_empresa','region','comuna','tipo_empresa','necesidad','whatsapp']) if(!req.body[f]) return res.status(400).json({error:`Falta el campo: ${f}`}); res.json(await db.updateCompanyProfile(req.company.id,req.body)); }catch(e){ res.status(500).json({error:'No se pudo actualizar el perfil.'}); }});
app.post('/api/company-login',rateLimit('login',8,10*60*1000),async(req,res)=>{ const s=await db.loginCompany(req.body.email,req.body.password); if(!s) return res.status(401).json({error:'Email o contraseña incorrectos.'}); res.json(s); });
app.post('/api/companies',rateLimit('companies',20,60*60*1000),async(req,res)=>{ try{ const bad=validateCompanyPayload(req.body); if(bad) return res.status(400).json({error:bad}); for(const f of ['nombre','rut_empresa','region','comuna','tipo_empresa','necesidad','email','whatsapp','password']) if(!req.body[f]) return res.status(400).json({error:`Falta el campo: ${f}`}); res.status(201).json(await db.createCompany(req.body)); }catch(e){ res.status(500).json({error:e.message.includes('UNIQUE')?'Ya existe una empresa con ese email.':'No se pudo registrar la empresa.'}); }});
app.get('/api/companies',async(req,res)=>res.json(await db.listCompanies({q:req.query.q})));
app.get('/api/companies/:id/public',async(req,res)=>{ try{ const page=await db.getCompanyPublicPage(req.params.id); if(!page) return res.status(404).json({error:'Empresa no encontrada o no disponible.'}); res.json(page); }catch(e){ res.status(500).json({error:'No se pudo cargar el perfil público de la empresa.'}); }});
app.post('/api/company-plan',requireCompany,async(req,res)=>{
  const plan=String(req.body.plan||'').toLowerCase();
  if(plan==='paid' && !isDemoBillingEnabled()) return res.status(402).json(paymentRequiredPayload());
  try{ res.json(await db.updateCompanyPlan(req.company.id,plan)); }
  catch(e){ res.status(400).json({error:e.message||'No se pudo cambiar el plan.'}); }
});
app.post('/api/company-plan/checkout',requireCompany,async(req,res)=>{
  if(isDemoBillingEnabled()) return res.json({demo:true,message:'Modo demo activo. Usa /api/company-plan para activar Pagado sin pasarela.'});
  if(process.env.PAYMENT_CHECKOUT_URL) return res.json({checkout_url:process.env.PAYMENT_CHECKOUT_URL,amount:'0,5 UF',period_days:30});
  res.status(501).json(paymentRequiredPayload());
});
app.post('/api/company-plan/cancel',requireCompany,async(req,res)=>res.json(await db.cancelCompanyPlan(req.company.id)));

app.post('/api/billing/webhook',async(req,res)=>{
  const secret=process.env.PAYMENT_WEBHOOK_SECRET;
  if(!secret) return res.status(503).json({error:'Webhook de pago no configurado.'});
  const provided=req.headers['x-payment-webhook-secret'] || req.headers['x-webhook-secret'];
  if(provided!==secret) return res.status(401).json({error:'Webhook no autorizado.'});
  const status=String(req.body.status || req.body.payment_status || req.body.event || '').toLowerCase();
  const paid=['paid','succeeded','approved','payment_succeeded','checkout.session.completed'].includes(status);
  if(!paid) return res.json({ok:true,ignored:true,status});
  try{
    const result= req.body.company_id ? await db.activateCompanyPaid(req.body.company_id) : await db.activateCompanyPaidByEmail(req.body.email);
    if(!result) return res.status(404).json({error:'Empresa no encontrada para activar el plan Pagado.'});
    res.json({ok:true,company:result});
  }catch(e){ res.status(400).json({error:e.message || 'No se pudo activar el plan Pagado.'}); }
});
app.get('/api/saved-searches',requireCompany,async(req,res)=>res.json(await db.listSavedSearches(req.company.id)));
app.post('/api/saved-searches',requireCompany,requirePaidCompany,async(req,res)=>res.status(201).json(await db.saveSearch(req.company.id,req.body)));
app.delete('/api/saved-searches/:id',requireCompany,async(req,res)=>res.json(await db.deleteSavedSearch(req.company.id,req.params.id)));
app.get('/api/profiles',async(req,res)=>{ const c=await db.getCompanyByToken(bearer(req)); const filters={q:req.query.q,tipo:req.query.tipo,licencia:req.query.licencia,region:req.query.region,page:req.query.page,limit:req.query.limit}; if(c) await db.trackEvent('search_profiles',{company_id:c.id,metadata:filters}); const result=await db.listProfiles(filters,c); res.json({...result,company:c}); });
app.post('/api/profiles',rateLimit('profiles',30,60*60*1000),uploadDriverDocs.fields([{name:'licencia_archivo',maxCount:1},{name:'hoja_vida_archivo',maxCount:1}]),uploadErrorHandler,async(req,res)=>{ try{ attachUploadedDriverDocs(req); if (typeof req.body.trucks === 'string') req.body.trucks = JSON.parse(req.body.trucks || '[]'); const bad=validateProfilePayload(req.body); if(bad) return res.status(400).json({error:bad}); if(req.body.email && !isEmail(req.body.email)) return res.status(400).json({error:'Email inválido.'}); if(!req.body.password || String(req.body.password).length<6) return res.status(400).json({error:'La contraseña debe tener al menos 6 caracteres.'}); for(const f of ['tipo','nombre','rut','region','comuna','experiencia','especialidad','disponibilidad','email','whatsapp','password']) if(req.body[f]===undefined||req.body[f]==='') return res.status(400).json({error:`Falta el campo: ${f}`}); if(req.body.tipo==='Chofer'&&!req.body.licencia) return res.status(400).json({error:'Falta licencia profesional.'}); if(req.body.tipo==='Chofer' && !req.body.documento_licencia) return res.status(400).json({error:'Sube la licencia de conducir en PDF, JPG o PNG.'}); if(req.body.tipo==='Chofer' && !req.body.hoja_vida_conductor) return res.status(400).json({error:'Sube la hoja de vida del conductor en PDF.'}); if(req.body.tipo==='Dueño de camión' && !(req.body.trucks||[]).some(t=>t.patente&&t.tipo)) return res.status(400).json({error:'Agrega al menos un camión con patente y tipo.'}); res.status(201).json(await db.createProfile(req.body)); }catch(e){ console.error(e); const msg=String(e.message||''); res.status(msg.startsWith('Archivo rechazado')?400:500).json({error:msg.startsWith('Archivo rechazado')?msg:'No se pudo guardar el perfil.'}); }});
app.get('/api/jobs',async(req,res)=>res.json(await db.listJobs({q:req.query.q,licencia:req.query.licencia,region:req.query.region,comuna:req.query.comuna})));
app.get('/api/jobs/:id',async(req,res)=>{ const job=await db.getJobById(req.params.id); if(!job) return res.status(404).json({error:'Oferta no encontrada, cerrada o con cupos completos.'}); res.json(job); });
app.post('/api/jobs',requireCompany,requireVerifiedCompany,requireCompanyProfileComplete,requireJobQuota,rateLimit('jobs',60,60*60*1000),async(req,res)=>{ try{ normalizeBody(req.body); for(const f of ['titulo','region','comuna','licencia','descripcion']) if(!req.body[f]) return res.status(400).json({error:`Falta el campo: ${f}`}); if(req.body.max_applications!==undefined && req.body.max_applications!=='' && Number(req.body.max_applications)<0) return res.status(400).json({error:'El máximo de postulaciones no puede ser negativo.'}); res.status(201).json(await db.createJob(req.company.id,req.body)); }catch(e){ res.status(500).json({error:e.message || 'No se pudo publicar el trabajo.'}); }});
app.put('/api/jobs/:id',requireCompany,requireVerifiedCompany,requireCompanyProfileComplete,async(req,res)=>{ try{ normalizeBody(req.body); for(const f of ['titulo','region','comuna','licencia','descripcion']) if(!req.body[f]) return res.status(400).json({error:`Falta el campo: ${f}`}); if(req.body.max_applications!==undefined && req.body.max_applications!=='' && Number(req.body.max_applications)<0) return res.status(400).json({error:'El máximo de postulaciones no puede ser negativo.'}); const job=await db.updateCompanyJob(req.company.id,req.params.id,req.body); if(!job) return res.status(404).json({error:'Oferta no encontrada o no pertenece a tu empresa.'}); res.json(job); }catch(e){ res.status(500).json({error:e.message || 'No se pudo editar la oferta.'}); }});
app.patch('/api/jobs/:id/status',requireCompany,requireVerifiedCompany,async(req,res)=>{ try{ const job=await db.updateCompanyJobStatus(req.company.id,req.params.id,req.body.estado||req.body.status); if(!job) return res.status(404).json({error:'Oferta no encontrada o no pertenece a tu empresa.'}); res.json(job); }catch(e){ res.status(400).json({error:e.message || 'No se pudo cambiar el estado de la oferta.'}); }});
app.delete('/api/jobs/:id',requireCompany,async(req,res)=>{ try{ const deleted=await db.deleteCompanyJob(req.company.id,req.params.id); if(!deleted) return res.status(404).json({error:'Oferta no encontrada o no pertenece a tu empresa.'}); res.json({ok:true,deleted}); }catch(e){ res.status(500).json({error:'No se pudo eliminar la oferta.'}); }});

app.get('/api/profile-dashboard',requireProfile,async(req,res)=>res.json(await db.getProfileDashboard(req.profile.id)));
app.put('/api/profile',requireProfile,async(req,res)=>{ try{ const bad=validateProfilePayload({...req.profile,...req.body}); if(bad) return res.status(400).json({error:bad}); for(const f of ['nombre','rut','region','comuna','experiencia','especialidad','disponibilidad','whatsapp']) if(req.body[f]===undefined||req.body[f]==='') return res.status(400).json({error:`Falta el campo: ${f}`}); if(req.profile.tipo==='Chofer' && !req.body.licencia) return res.status(400).json({error:'Falta licencia profesional.'}); res.json(await db.updateProfile(req.profile.id,req.body)); }catch(e){ console.error(e); res.status(500).json({error:'No se pudo actualizar el perfil.'}); }});
app.patch('/api/profile/availability',requireProfile,async(req,res)=>{ try{ const disponibilidad=clean(req.body.disponibilidad||'',120); if(!disponibilidad) return res.status(400).json({error:'Falta disponibilidad.'}); res.json(await db.updateProfileAvailability(req.profile.id,disponibilidad)); }catch(e){ res.status(500).json({error:'No se pudo actualizar la disponibilidad.'}); }});
app.post('/api/profile-password',requireProfile,rateLimit('profilePassword',8,10*60*1000),async(req,res)=>{ try{ const currentPassword=String(req.body.current_password||''), newPassword=String(req.body.new_password||''); if(newPassword.length<6) return res.status(400).json({error:'La nueva contraseña debe tener al menos 6 caracteres.'}); res.json(await db.changeProfilePassword(req.profile.id,currentPassword,newPassword)); }catch(e){ res.status(400).json({error:e.message||'No se pudo cambiar la contraseña.'}); }});
app.delete('/api/profile',requireProfile,async(req,res)=>{ try{ if(String(req.body.confirm||'')!=='ELIMINAR') return res.status(400).json({error:'Para eliminar la cuenta debes confirmar con la palabra ELIMINAR.'}); res.json(await db.deleteProfileAccount(req.profile.id)); }catch(e){ res.status(500).json({error:'No se pudo eliminar la cuenta.'}); }});

app.post('/api/applications',requireProfile,rateLimit('applications',30,60*60*1000),async(req,res)=>{ try{ normalizeBody(req.body); if(!req.body.job_id) return res.status(400).json({error:'Falta el campo: job_id'}); res.status(201).json(await db.applyToJob(req.profile.id,req.body)); }catch(e){ if(e.code==='DUPLICATE_APPLICATION') return res.status(409).json({error:e.message}); if(e.code==='APPLICATION_LIMIT_REACHED') return res.status(409).json({error:e.message}); res.status(500).json({error:e.message || 'No se pudo enviar la postulación.'}); }});
app.get('/api/my-applications',requireProfile,async(req,res)=>res.json(await db.listApplicationsForProfile(req.profile.id)));
app.get('/api/company-applications',requireCompany,async(req,res)=>{ const rows=await db.listApplicationsForCompany(req.company.id); const perms=db.businessPermissions(req.company); const lockReason=!req.company.verificada?'verification_required':'paid_plan_required'; res.json(perms.can_unlock_contacts?rows:rows.map(a=>maskApplicationContacts(a,lockReason))); });
app.patch('/api/applications/:id/status',requireCompany,requireVerifiedCompany,async(req,res)=>{ try{ res.json(await db.updateApplicationStatus(req.company.id,req.params.id,req.body.status,req.body.message||'')); }catch(e){ res.status(400).json({error:e.message || 'No se pudo actualizar el estado.'}); }});
app.patch('/api/applications/:id/withdraw',requireProfile,async(req,res)=>{ try{ res.json(await db.withdrawApplication(req.profile.id,req.params.id,req.body.message||'')); }catch(e){ res.status(400).json({error:e.message || 'No se pudo retirar la postulación.'}); }});
app.get('/api/reputation',async(req,res)=>res.json(await db.reputationSummary()));
app.get('/api/reviews/:targetType/:targetId',async(req,res)=>{ try{ if(!['profile','company'].includes(req.params.targetType)) return res.status(400).json({error:'Tipo inválido'}); res.json(await db.listReviews(req.params.targetType,req.params.targetId)); }catch(e){ res.status(500).json({error:'No se pudieron cargar las evaluaciones.'}); }});
app.get('/api/can-review/profile/:id',requireCompany,async(req,res)=>{ const base=await db.canCompanyReviewProfile(req.company.id,req.params.id); res.json({...base,can_review:base.can_review && db.canCompanyUnlockContacts(req.company),requires_verified_paid:!db.canCompanyUnlockContacts(req.company)}); });
app.get('/api/can-review/company/:id',requireProfile,async(req,res)=>res.json(await db.canProfileReviewCompany(req.profile.id,req.params.id)));
app.post('/api/reviews/profile/:id',requireCompany,requireContactAccess,async(req,res)=>{ try{ res.status(201).json(await db.createProfileReview(req.company.id,req.params.id,req.body)); }catch(e){ res.status(400).json({error:e.message || 'No se pudo guardar la evaluación.'}); }});
app.post('/api/reviews/company/:id',requireProfile,rateLimit('companyReviews',20,60*60*1000),async(req,res)=>{ try{ normalizeBody(req.body); if(!req.body.rating || !req.body.comment) return res.status(400).json({error:'Falta calificación o comentario.'}); res.status(201).json(await db.createCompanyReview(req.profile.id,req.params.id,req.body)); }catch(e){ res.status(400).json({error:e.message || 'No se pudo guardar la evaluación.'}); }});
// Fallback para navegación del frontend
app.post('/api/admin/login', rateLimit('adminLogin',8,10*60*1000), async(req,res)=>{
  const configuredUser = process.env.ADMIN_EMAIL || process.env.ADMIN_USER;
  const configuredPass = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS;
  if(!configuredUser || !configuredPass) return res.status(503).json({error:'Admin no configurado. Define ADMIN_EMAIL y ADMIN_PASSWORD en Render.'});
  const emailOk = String(req.body.email||'').trim().toLowerCase() === String(configuredUser).trim().toLowerCase();
  const passOk = timingSafeEq(req.body.password||'', configuredPass);
  if(!emailOk || !passOk) return res.status(401).json({error:'Email o contraseña de administrador incorrectos.'});
  const session = makeAdminSession();
  adminSessions.set(session,{created_at:Date.now(),email:configuredUser});
  res.json({session,admin:{email:configuredUser}});
});
app.post('/api/admin/logout', requireAdmin, async(req,res)=>{ const session=getAdminAuth(req); if(session) adminSessions.delete(session); res.json({ok:true}); });
app.get('/api/admin/summary', requireAdmin, async(_req,res)=>res.json(await db.adminSummary()));
app.get('/api/admin/companies', requireAdmin, async(req,res)=>res.json(await db.adminListCompanies({q:req.query.q,estado:req.query.estado})));
app.get('/api/admin/profiles', requireAdmin, async(req,res)=>res.json(await db.adminListProfiles({q:req.query.q,estado:req.query.estado,tipo:req.query.tipo})));
app.get('/api/admin/jobs', requireAdmin, async(_req,res)=>res.json(await db.adminListJobs()));
app.get('/api/admin/applications', requireAdmin, async(_req,res)=>res.json(await db.adminListApplications()));
app.get('/api/admin/pending-documents', requireAdmin, async(_req,res)=>res.json(await db.listPendingDocuments()));
app.patch('/api/admin/profiles/:id/verification', requireAdmin, async(req,res)=>{ try{ const allowed=['pendiente','aprobado','rechazado','vencido']; const estado=req.body.documento_estado; if(estado && !allowed.includes(estado)) return res.status(400).json({error:'Estado documental inválido.'}); res.json(await db.adminUpdateProfileVerification(req.params.id,{verificado:req.body.verificado,documento_estado:estado})); }catch(e){ res.status(500).json({error:'No se pudo actualizar el perfil.'}); }});
app.patch('/api/admin/companies/:id/verification', requireAdmin, async(req,res)=>{ try{ res.json(await db.adminUpdateCompanyVerification(req.params.id,{verificada:req.body.verificada,plan:req.body.plan})); }catch(e){ res.status(500).json({error:'No se pudo actualizar la empresa.'}); }});
app.get('/api/admin/profile-document/:id/:kind', requireAdmin, async(req,res)=>{ try{ const doc=await db.adminGetProfileDocument(req.params.id,req.params.kind); if(!doc?.path) return res.status(404).send('Documento no disponible.'); const full=path.join(__dirname, doc.path.replace(/^\//,'')); if(!full.startsWith(path.join(__dirname,'uploads','drivers')) || !fs.existsSync(full)) return res.status(404).send('Documento no encontrado.'); res.sendFile(full); }catch(e){ res.status(500).send('No se pudo abrir el documento.'); }});
app.get('*', (req,res,next)=>{
  if (req.path.startsWith('/api/')) return next();
  res.status(404).sendFile(path.join(__dirname,'index.html'));
});

app.use((err, req, res, _next) => {
  console.error('API error:', req.method, req.path, err && (err.stack || err.message || err));
  if (res.headersSent) return;
  const status = err && err.status ? err.status : 500;
  res.status(status).json({error: status >= 500 ? 'Ocurrió un error interno. Revisa la consola del servidor.' : err.message});
});

(async()=>{ try{ await db.migrate(); if(String(process.env.SEED_DEMO || '').toLowerCase()==='true') await db.seedIfEmpty(); app.listen(port,()=>console.log(`ChoferLink en http://localhost:${port} con ${db.client}`)); }catch(e){ console.error('Error iniciando la aplicación:',e); process.exit(1); }})();
