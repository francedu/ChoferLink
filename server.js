try { require('dotenv').config(); } catch (_) { /* .env opcional */ }
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const dns = require('dns');
const multer = require('multer');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) { nodemailer = null; }
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
const companyUploadDir = path.join(__dirname, 'uploads', 'companies');
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(companyUploadDir, { recursive: true });
const MAX_DOC_SIZE_MB = 2;
const storage = multer.diskStorage({
  destination: (_req, file, cb) => cb(null, file.fieldname === 'documento_empresa_archivo' ? companyUploadDir : uploadDir),
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
        : file.fieldname === 'documento_empresa_archivo'
          ? ['application/pdf','image/jpeg','image/png'].includes(file.mimetype)
          : true;
    if (!okByField) return cb(new Error('Formato no permitido. Licencia: PDF/JPG/PNG. Hoja de vida: PDF. Documento empresa: PDF/JPG/PNG.'));
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
  if (file.fieldname === 'documento_empresa_archivo') return (file.mimetype === 'application/pdf' && isPdf) || (file.mimetype === 'image/png' && isPng) || (file.mimetype === 'image/jpeg' && isJpg);
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

const uploadCompanyDoc = uploadDriverDocs.single('documento_empresa_archivo');
function attachUploadedCompanyDoc(req){
  const file = req.file;
  if (!file) return;
  if (!isAllowedUploadedFile(file)) { try { fs.unlinkSync(file.path); } catch (_) {} throw new Error('Archivo rechazado: el contenido no coincide con el formato permitido.'); }
  req.body.documento_empresa = `/uploads/companies/${file.filename}`;
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
app.get('/recuperar', (req,res)=>res.sendFile(path.join(__dirname,'recuperar.html')));
app.get('/admin', (req,res)=>res.sendFile(path.join(__dirname,'admin.html')));
app.get('/perfil', (req,res)=>res.sendFile(path.join(__dirname,'perfil.html')));
app.get('/buscar', (req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/trabajos/:id', (req,res)=>res.sendFile(path.join(__dirname,'index.html')));

Object.entries(companyRouteFiles).forEach(([route, file]) => {
  app.get(route, (req,res)=>res.sendFile(path.join(__dirname,file)));
});
app.get('/empresa-publica/:id', (req,res)=>res.sendFile(path.join(__dirname,'empresa-publica.html')));
function bearer(req){ return (req.headers.authorization||'').replace('Bearer ',''); }
async function requireCompany(req,res,next){ const c=await db.getCompanyByToken(bearer(req)); if(!c) return res.status(401).json({error:'Debes iniciar sesión como empresa.'}); if(!c.email_verified) return res.status(403).json({error:'Debes verificar tu email antes de usar tu cuenta. Revisa tu correo o solicita un nuevo enlace.'}); req.company=c; next(); }
async function requireProfile(req,res,next){ const p=await db.getProfileByToken((req.headers['x-profile-token']||'').toString() || bearer(req)); if(!p) return res.status(401).json({error:'Debes iniciar sesión con un perfil registrado para postular.'}); if(!p.email_verified) return res.status(403).json({error:'Debes verificar tu email antes de postular o gestionar tu perfil. Revisa tu correo o solicita un nuevo enlace.'}); req.profile=p; next(); }
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
    error: 'Para activar el plan Pagado debes completar el pago mensual mediante Flow.',
    code: 'payment_required',
    checkout_url: process.env.PAYMENT_CHECKOUT_URL || null,
    instructions: 'Configura FLOW_API_KEY, FLOW_SECRET_KEY y FLOW_BASE_URL en Render. Usa BILLING_MODE=demo solo en desarrollo.'
  };
}

function flowConfig(){
  const apiKey=process.env.FLOW_API_KEY;
  const secret=process.env.FLOW_SECRET_KEY;
  const baseUrl=(process.env.FLOW_BASE_URL || 'https://sandbox.flow.cl/api').replace(/\/$/,'');
  const publicUrl=(process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/,'');
  return {apiKey,secret,baseUrl,publicUrl};
}
function flowReady(){ const c=flowConfig(); return Boolean(c.apiKey && c.secret); }
function flowSign(params){
  const {secret}=flowConfig();
  const text=Object.keys(params).filter(k=>k!=='s' && params[k]!==undefined && params[k]!==null).sort().map(k=>`${k}${params[k]}`).join('');
  return crypto.createHmac('sha256', secret).update(text).digest('hex');
}
async function flowRequest(pathname, params={}, method='GET'){
  const cfg=flowConfig();
  if(!cfg.apiKey || !cfg.secret) throw new Error('Flow no está configurado. Define FLOW_API_KEY y FLOW_SECRET_KEY en Render.');
  const signed={...params, apiKey:cfg.apiKey};
  signed.s=flowSign(signed);
  const url=new URL(`${cfg.baseUrl}${pathname}`);
  const options={method};
  if(method==='GET') Object.entries(signed).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  else { options.headers={'Content-Type':'application/x-www-form-urlencoded'}; options.body=new URLSearchParams(Object.entries(signed).map(([k,v])=>[k,String(v)])).toString(); }
  const response=await fetch(url,options);
  const text=await response.text();
  let data;
  try{ data=JSON.parse(text); }catch{ data={raw:text}; }
  if(!response.ok || data.code){ throw new Error(data.message || data.error || `Flow respondió HTTP ${response.status}`); }
  return data;
}
function paymentStatusFromFlow(status){
  const n=Number(status);
  if(n===2) return 'paid';
  if(n===3) return 'rejected';
  if(n===4) return 'cancelled';
  return 'pending';
}
async function confirmFlowToken(token){
  if(!token) throw new Error('Token de Flow faltante.');
  const status=await flowRequest('/payment/getStatus',{token},'GET');
  const localStatus=paymentStatusFromFlow(status.status);
  if(localStatus==='paid') return db.activateCompanyPaidFromPayment(token,status);
  const payment=await db.updatePaymentFromFlow(token,localStatus,status.flowOrder,status);
  return {payment,flow:status};
}



function publicBaseUrl(req){ return (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/,''); }
function emailVerificationUrl(req,token){ return `${publicBaseUrl(req)}/api/email/verify?token=${encodeURIComponent(token)}`; }
function passwordResetUrl(req,token){ return `${publicBaseUrl(req)}/api/password/reset?token=${encodeURIComponent(token)}`; }

async function sendEmailViaSmtp({to,subject,html,text}){
  if(!process.env.SMTP_HOST) return {ok:false,skipped:true,reason:'SMTP_HOST no configurado'};
  if(!nodemailer) throw new Error('nodemailer no está instalado. Ejecuta npm install nodemailer y vuelve a desplegar.');

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const pass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '';

  const timeoutMs = Number(process.env.SMTP_TIMEOUT_MS || 60000);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    name: process.env.SMTP_CLIENT_NAME || 'choferlink.onrender.com',
    family: 4,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    dnsLookup: (hostname, options, callback) => {
      dns.lookup(hostname, { family: 4 }, callback);
    },
    auth: process.env.SMTP_USER ? {
      user: process.env.SMTP_USER,
      pass
    } : undefined,
    tls: {
      rejectUnauthorized: false,
      servername: process.env.SMTP_HOST
    }
  });
  const from=process.env.SMTP_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER || 'ChoferLink <no-reply@choferlink.cl>';
  const info=await transporter.sendMail({from,to,subject,text,html});
  console.log('Email verification sent via SMTP to', to, info.messageId || 'sin-message-id');
  return {ok:true,provider:'smtp',messageId:info.messageId};
}
async function sendEmailViaResend({to,subject,html,text}){
  const apiKey=process.env.RESEND_API_KEY;
  if(!apiKey) return {ok:false,skipped:true,reason:'RESEND_API_KEY no configurado'};
  const from=process.env.EMAIL_FROM || process.env.SMTP_FROM || 'ChoferLink <no-reply@choferlink.cl>';
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({from,to,subject,html,text})});
  if(!r.ok){ const body=await r.text().catch(()=>''); throw new Error(`No se pudo enviar email (${r.status}): ${body.slice(0,200)}`); }
  console.log('Email verification sent via Resend to', to);
  return {ok:true,provider:'resend'};
}
async function deliverEmail(payload){
  const mode=String(process.env.EMAIL_DELIVERY || (process.env.SMTP_HOST?'smtp':(process.env.RESEND_API_KEY?'resend':'console'))).toLowerCase();
  if(mode==='console') return {ok:false,skipped:true,console:true,reason:'EMAIL_DELIVERY=console'};
  if(mode==='smtp') return sendEmailViaSmtp(payload);
  if(mode==='resend') return sendEmailViaResend(payload);
  // auto: intenta SMTP, luego Resend, luego consola
  if(process.env.SMTP_HOST) return sendEmailViaSmtp(payload);
  if(process.env.RESEND_API_KEY) return sendEmailViaResend(payload);
  return {ok:false,skipped:true,console:true,reason:'Sin proveedor SMTP/Resend configurado'};
}
async function sendVerificationEmail(req,target){
  if(!target?.email) return {ok:false,skipped:true};
  const link=emailVerificationUrl(req,target.token);
  const subject='Verifica tu email en ChoferLink';
  const text=`Hola ${target.nombre||''}. Verifica tu email entrando a este enlace: ${link}. El enlace vence en 24 horas.`;
  const html=`<div style="font-family:Arial,sans-serif;line-height:1.5"><h2>Verifica tu email en ChoferLink</h2><p>Hola ${String(target.nombre||'').replace(/[<>]/g,'')},</p><p>Para activar tu cuenta, confirma tu email con el siguiente botón. El enlace vence en 24 horas.</p><p><a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Verificar email</a></p><p>Si el botón no funciona, copia este enlace:</p><p>${link}</p></div>`;
  console.log('Attempting email verification delivery to', target.email);
  try{
    const result=await deliverEmail({to:target.email,subject,html,text});
    if(result.console || result.skipped){
      console.log('EMAIL_VERIFICATION_LINK', target.email, link, '-', result.reason || 'sin proveedor configurado');
      return {ok:true,console:true,link};
    }
    return result;
  }catch(e){
    console.error('Email verification send error:', e.message);
    if(!isProduction){ console.log('EMAIL_VERIFICATION_LINK', target.email, link); return {ok:true,console:true,link}; }
    throw e;
  }
}

async function sendPasswordResetEmail(req,target){
  if(!target?.email) return {ok:false,skipped:true};
  const link=passwordResetUrl(req,target.token);
  const subject='Recupera tu contraseña en ChoferLink';
  const text=`Hola ${target.nombre||''}. Para crear una nueva contraseña entra a este enlace: ${link}. El enlace vence en 24 horas.`;
  const html=`<div style="font-family:Arial,sans-serif;line-height:1.5"><h2>Recupera tu contraseña en ChoferLink</h2><p>Hola ${String(target.nombre||'').replace(/[<>]/g,'')},</p><p>Recibimos una solicitud para recuperar tu contraseña. Usa este botón dentro de las próximas 24 horas.</p><p><a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Crear nueva contraseña</a></p><p>Si no pediste este cambio, puedes ignorar este mensaje.</p><p>${link}</p></div>`;
  console.log('Attempting password reset delivery to', target.email);
  const result=await deliverEmail({to:target.email,subject,html,text});
  if(result.console || result.skipped) console.log('PASSWORD_RESET_LINK', target.email, link, '-', result.reason || 'sin proveedor configurado');
  return {...result,link:result.console||result.skipped?link:undefined};
}

async function createAndSendVerification(req,userType,userId){
  const target=await db.createEmailVerification(userType,userId);
  if(!target) return null;
  const send=await sendVerificationEmail(req,target);
  return {...send,email:target.email,expires_at:target.expires_at};
}


function adminNotifyEmails(){
  return (process.env.ADMIN_NOTIFY_EMAILS || process.env.ADMIN_EMAIL || '')
    .split(',')
    .map(x=>x.trim())
    .filter(Boolean);
}
function adminPanelUrl(req){ return `${publicBaseUrl(req)}/admin.html`; }
function escHtml(v){ return String(v||'').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
async function safeDeliverOperationalEmail(payload, eventMeta={}){
  try{
    const emails = Array.isArray(payload.to) ? payload.to : String(payload.to||'').split(',').map(x=>x.trim()).filter(Boolean);
    if(!emails.length) return {ok:false,skipped:true,reason:'sin destinatario'};
    const results=[];
    for(const to of emails){ results.push(await deliverEmail({...payload,to})); }
    return {ok:true,results};
  }catch(e){
    console.error('Operational email error:', e.message);
    try{ await db.trackEvent('operational_email_failed',{metadata:{...eventMeta,error:e.message,subject:payload.subject||''}}); }catch(_){ }
    return {ok:false,error:e.message};
  }
}
async function notifyAdminNewCompany(req,company){
  const to=adminNotifyEmails();
  if(!to.length || !company) return;
  const subject=`Nueva empresa pendiente: ${company.nombre||company.razon_social||company.email}`;
  const text=`Nueva empresa registrada en ChoferLink.\n\nEmpresa: ${company.nombre||''}\nRazón social: ${company.razon_social||''}\nRUT: ${company.rut_empresa||''}\nEmail: ${company.email||''}\nWhatsApp: ${company.whatsapp||''}\nRegión/comuna: ${company.region||''} / ${company.comuna||''}\nDocumento: ${company.documento_empresa?'Sí':'No'}\n\nRevisar: ${adminPanelUrl(req)}`;
  const html=`<div style="font-family:Arial,sans-serif;line-height:1.45"><h2>Nueva empresa pendiente de validación</h2><p>Se registró una nueva empresa y requiere revisión documental.</p><table cellpadding="6" cellspacing="0" style="border-collapse:collapse"><tr><td><b>Empresa</b></td><td>${escHtml(company.nombre)}</td></tr><tr><td><b>Razón social</b></td><td>${escHtml(company.razon_social)}</td></tr><tr><td><b>RUT</b></td><td>${escHtml(company.rut_empresa)}</td></tr><tr><td><b>Email</b></td><td>${escHtml(company.email)}</td></tr><tr><td><b>WhatsApp</b></td><td>${escHtml(company.whatsapp)}</td></tr><tr><td><b>Ubicación</b></td><td>${escHtml([company.comuna,company.region].filter(Boolean).join(', '))}</td></tr><tr><td><b>Documento</b></td><td>${company.documento_empresa?'Subido':'No disponible'}</td></tr></table><p><a href="${adminPanelUrl(req)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Abrir panel admin</a></p></div>`;
  await safeDeliverOperationalEmail({to,subject,text,html},{type:'admin_new_company',company_id:company.id});
  try{ await db.trackEvent('admin_email_new_company_sent',{company_id:company.id,metadata:{to_count:to.length}}); }catch(_){ }
}
async function notifyAdminNewProfile(req,profile){
  const to=adminNotifyEmails();
  if(!to.length || !profile) return;
  const needsDocs = profile.tipo==='Chofer' || profile.documento_licencia || profile.hoja_vida_conductor;
  const subject=`Nuevo perfil ${needsDocs?'pendiente documental':'registrado'}: ${profile.nombre||profile.email}`;
  const text=`Nuevo perfil registrado en ChoferLink.\n\nNombre: ${profile.nombre||''}\nTipo: ${profile.tipo||''}\nRUT: ${profile.rut||''}\nEmail: ${profile.email||''}\nWhatsApp: ${profile.whatsapp||''}\nLicencia: ${profile.licencia||''}\nDocumento licencia: ${profile.documento_licencia?'Sí':'No'}\nHoja de vida: ${profile.hoja_vida_conductor?'Sí':'No'}\n\nRevisar: ${adminPanelUrl(req)}`;
  const html=`<div style="font-family:Arial,sans-serif;line-height:1.45"><h2>Nuevo perfil registrado</h2><p>${needsDocs?'Requiere validación documental antes de otorgar acceso completo.':'Registro creado en la plataforma.'}</p><table cellpadding="6" cellspacing="0" style="border-collapse:collapse"><tr><td><b>Nombre</b></td><td>${escHtml(profile.nombre)}</td></tr><tr><td><b>Tipo</b></td><td>${escHtml(profile.tipo)}</td></tr><tr><td><b>RUT</b></td><td>${escHtml(profile.rut)}</td></tr><tr><td><b>Email</b></td><td>${escHtml(profile.email)}</td></tr><tr><td><b>WhatsApp</b></td><td>${escHtml(profile.whatsapp)}</td></tr><tr><td><b>Licencia</b></td><td>${escHtml(profile.licencia)}</td></tr><tr><td><b>Documento licencia</b></td><td>${profile.documento_licencia?'Subido':'No'}</td></tr><tr><td><b>Hoja de vida</b></td><td>${profile.hoja_vida_conductor?'Subida':'No'}</td></tr></table><p><a href="${adminPanelUrl(req)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Abrir panel admin</a></p></div>`;
  await safeDeliverOperationalEmail({to,subject,text,html},{type:'admin_new_profile',profile_id:profile.id});
  try{ await db.trackEvent('admin_email_new_profile_sent',{profile_id:profile.id,metadata:{to_count:to.length}}); }catch(_){ }
}
async function notifyCompanyVerificationResult(req,company,action){
  if(!company?.email) return;
  const approved = action==='approved';
  const subject = approved ? 'Tu empresa fue verificada en ChoferLink' : 'Actualización de validación de empresa en ChoferLink';
  const text = approved
    ? `Hola ${company.nombre||company.razon_social||''}. Tu empresa fue verificada correctamente en ChoferLink. Ya puedes usar funciones disponibles para empresas verificadas. ${publicBaseUrl(req)}/empresa.html`
    : `Hola ${company.nombre||company.razon_social||''}. Tu empresa aún no fue verificada. Revisa tus documentos y datos de empresa en ChoferLink. ${publicBaseUrl(req)}/empresa.html`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.5"><h2>${approved?'Empresa verificada':'Validación de empresa pendiente'}</h2><p>Hola ${escHtml(company.nombre||company.razon_social)},</p><p>${approved?'Tu empresa fue verificada correctamente. Ya puedes acceder a funciones habilitadas para empresas verificadas.':'Tu empresa aún no fue verificada. Revisa los datos/documentos cargados y vuelve a solicitar revisión si corresponde.'}</p><p><a href="${publicBaseUrl(req)}/empresa.html" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Ir a mi empresa</a></p></div>`;
  await safeDeliverOperationalEmail({to:company.email,subject,text,html},{type:'company_verification_result',company_id:company.id,approved});
}
async function notifyProfileVerificationResult(req,profile,action){
  if(!profile?.email) return;
  const approved = action==='approved';
  const subject = approved ? 'Tus documentos fueron aprobados en ChoferLink' : 'Actualización de documentos en ChoferLink';
  const text = approved
    ? `Hola ${profile.nombre||''}. Tus documentos fueron aprobados en ChoferLink. Ya puedes usar tu perfil con acceso habilitado. ${publicBaseUrl(req)}/perfil.html`
    : `Hola ${profile.nombre||''}. Tus documentos requieren revisión/corrección. Entra a ChoferLink para revisar tu perfil. ${publicBaseUrl(req)}/perfil.html`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.5"><h2>${approved?'Documentos aprobados':'Documentos pendientes o rechazados'}</h2><p>Hola ${escHtml(profile.nombre)},</p><p>${approved?'Tus documentos fueron aprobados. Tu perfil queda habilitado según las reglas de ChoferLink.':'Tus documentos requieren revisión o corrección. Entra a tu perfil para revisar el estado.'}</p><p><a href="${publicBaseUrl(req)}/perfil.html" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Ir a mi perfil</a></p></div>`;
  await safeDeliverOperationalEmail({to:profile.email,subject,text,html},{type:'profile_verification_result',profile_id:profile.id,approved});
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
function cleanRut(rut){ return String(rut||'').replace(/\./g,'').replace(/-/g,'').replace(/\s+/g,'').toUpperCase(); }
function formatRut(rut){ const value=cleanRut(rut); return value?`${value.slice(0,-1)}-${value.slice(-1)}`:''; }
function validateRut(rut){ const value=cleanRut(rut); if(!/^\d{7,8}[0-9K]$/.test(value)) return false; const body=value.slice(0,-1), dv=value.slice(-1); if(/^(\d)\1+$/.test(body)) return false; let sum=0,m=2; for(let i=body.length-1;i>=0;i--){ sum += Number(body[i])*m; m = m===7 ? 2 : m+1; } const calc=11-(sum%11); const expected=calc===11?'0':calc===10?'K':String(calc); return dv===expected; }
function normalizeBody(body){ for(const k of Object.keys(body||{})){ if(typeof body[k]==='string') body[k]=clean(body[k], k==='descripcion'||k==='comment'||k==='mensaje'?800:180); } return body; }
function isCompanyRut(rut){ const body=Number(cleanRut(rut).slice(0,-1)); return Number.isFinite(body) && body >= 50000000; }
function hasCompanyLegalName(name){ return /\b(spa|s\.?p\.?a\.?|ltda\.?|limitada|eirl|e\.?i\.?r\.?l\.?|s\.?a\.?|sociedad anonima|sociedad por acciones)\b/i.test(String(name||'')); }
const COMPANY_NEEDS = new Set(['Choferes','Peonetas','Dueños de camión','Choferes y peonetas','Choferes y dueños de camión','Servicio completo de transporte','Operadores logísticos','Otro perfil de transporte']);
function validateCompanyNeed(value){ return COMPANY_NEEDS.has(String(value||'').trim()); }
function validateProfilePayload(b){ normalizeBody(b); if(b.rut && !validateRut(b.rut)) return 'RUT inválido. Usa un formato válido, ej: 12.345.678-5.'; if(b.email && !isEmail(b.email)) return 'Email inválido.'; if(b.whatsapp && !isPhoneCL(b.whatsapp)) return 'WhatsApp inválido. Usa un número válido, ej: +56 9 1234 5678.'; if(b.licencia && !['A2','A3','A4','A5',''].includes(b.licencia)) return 'Licencia inválida.'; for(const t of (b.trucks||[])){ t.patente=clean(t.patente,12).toUpperCase(); if(t.patente && !/^[A-Z]{2,4}[- ]?[0-9]{2,4}$/.test(t.patente)) return `Patente inválida: ${t.patente}`; } return null; }
function validateCompanyPayload(b){ normalizeBody(b); if(b.rut_empresa){ if(!validateRut(b.rut_empresa)) return 'RUT empresa inválido. Revisa el número y el dígito verificador.'; if(!isCompanyRut(b.rut_empresa)) return 'Debes ingresar un RUT de empresa/persona jurídica, no un RUT personal.'; b.rut_empresa=formatRut(b.rut_empresa); } if(!String(b.razon_social||'').trim()) return 'La razón social es obligatoria para verificar empresas.'; if(b.razon_social && !hasCompanyLegalName(b.razon_social)) return 'La razón social debe corresponder a una empresa, por ejemplo SpA, Ltda., EIRL o S.A.'; if(b.necesidad && !validateCompanyNeed(b.necesidad)) return 'Selecciona una necesidad válida desde la lista.'; if(b.email && !isEmail(b.email)) return 'Email inválido.'; if(b.whatsapp && !isPhoneCL(b.whatsapp)) return 'WhatsApp inválido.'; if(b.password && String(b.password).length<6) return 'La clave debe tener al menos 6 caracteres.'; return null; }
app.get('/api/health',(req,res)=>res.json({ok:true,database:db.client}));
app.get('/api/stats',async(req,res)=>res.json(await db.stats()));
app.get('/api/me',async(req,res)=>res.json({company:await db.getCompanyByToken(bearer(req)),profile:await db.getProfileByToken((req.headers['x-profile-token']||'').toString())}));
app.post('/api/profile-login',rateLimit('profileLogin',8,10*60*1000),async(req,res)=>{ try{ const s=await db.loginProfile(req.body.email,req.body.password); if(!s){ await db.trackEvent('login_failed_profile',{metadata:{email:req.body.email||'',ip:req.ip}}); return res.status(401).json({error:'Email o contraseña incorrectos.'}); } await db.trackEvent('login_success_profile',{profile_id:s.profile?.id,metadata:{ip:req.ip}}); res.json(s); }catch(e){ res.status(e.code==='EMAIL_NOT_VERIFIED'?403:500).json({error:e.message||'No se pudo iniciar sesión.'}); } });
app.get('/api/business-rules',(_req,res)=>res.json(db.BUSINESS_RULES));
app.get('/api/email/verify',async(req,res)=>{ try{ const out=await db.verifyEmailToken(req.query.token||''); res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email verificado</title><link rel="stylesheet" href="/styles.css"></head><body><main class="section"><div class="panel"><h1>Email verificado</h1><p>Tu correo fue confirmado correctamente. Ya puedes iniciar sesión en ChoferLink.</p><a class="btn primary" href="${out.user_type==='company'?'/empresa':'/registro'}">Continuar</a></div></main></body></html>`); }catch(e){ res.status(400).send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Error de verificación</title><link rel="stylesheet" href="/styles.css"></head><body><main class="section"><div class="panel"><h1>No se pudo verificar</h1><p>${String(e.message||'Token inválido').replace(/[<>]/g,'')}</p><a class="btn" href="/registro">Volver</a></div></main></body></html>`); } });
app.post('/api/email/resend',rateLimit('emailResend',6,60*60*1000),async(req,res)=>{ try{ const userType=String(req.body.user_type||req.body.type||'company').toLowerCase(); const email=String(req.body.email||'').toLowerCase(); if(!isEmail(email)) return res.status(400).json({error:'Email inválido.'}); const target=await db.getEmailVerificationTarget(userType,email); if(!target) return res.status(404).json({error:'No encontramos una cuenta con ese email.'}); if(target.email_verified) return res.json({ok:true,message:'Ese email ya está verificado.'}); const sent=await createAndSendVerification(req,userType,target.id); res.json({ok:true,message:'Enviamos un nuevo enlace de verificación.',delivery:sent?.console?'console':'email'}); }catch(e){ res.status(500).json({error:e.message||'No se pudo reenviar la verificación.'}); } });

app.post('/api/password/forgot',rateLimit('passwordForgot',6,60*60*1000),async(req,res)=>{ try{ const email=String(req.body.email||'').toLowerCase(); const userType=String(req.body.user_type||req.body.type||'company').toLowerCase()==='profile'?'profile':'company'; if(!isEmail(email)) return res.status(400).json({error:'Email inválido.'}); const target=await db.createPasswordReset(userType,email); if(target) await sendPasswordResetEmail(req,target); await db.trackEvent('password_reset_form_submitted',{metadata:{email,user_type:userType,exists:Boolean(target)}}); res.json({ok:true,message:'Si existe una cuenta con ese email, enviaremos un enlace de recuperación.'}); }catch(e){ console.error('Password reset request error:',e); res.status(500).json({error:'No se pudo procesar la recuperación.'}); }});
app.get('/api/password/reset',async(req,res)=>{ const token=String(req.query.token||''); res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recuperar contraseña</title><link rel="stylesheet" href="/styles.css"></head><body><main class="section"><div class="panel"><h1>Nueva contraseña</h1><p>Ingresa una nueva contraseña para tu cuenta ChoferLink.</p><form class="form" method="post" action="/api/password/reset"><input type="hidden" name="token" value="${token.replace(/["<>]/g,'')}"><input type="password" name="password" placeholder="Nueva contraseña" minlength="6" required><button class="btn primary">Guardar contraseña</button></form></div></main></body></html>`); });
app.post('/api/password/reset',rateLimit('passwordReset',10,60*60*1000),async(req,res)=>{ try{ const out=await db.resetPasswordByToken(req.body.token||'',req.body.password||''); res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contraseña actualizada</title><link rel="stylesheet" href="/styles.css"></head><body><main class="section"><div class="panel"><h1>Contraseña actualizada</h1><p>Tu contraseña fue cambiada correctamente. Ya puedes iniciar sesión.</p><a class="btn primary" href="${out.user_type==='company'?'/empresa':'/registro'}">Iniciar sesión</a></div></main></body></html>`); }catch(e){ res.status(400).send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Error</title><link rel="stylesheet" href="/styles.css"></head><body><main class="section"><div class="panel"><h1>No se pudo actualizar</h1><p>${String(e.message||'Token inválido').replace(/[<>]/g,'')}</p><a class="btn" href="/registro">Volver</a></div></main></body></html>`); }});

app.get('/api/company-subscription',requireCompany,async(req,res)=>res.json(await db.companySubscriptionStatus(req.company.id)));
app.get('/api/company-dashboard',requireCompany,async(req,res)=>{ const perms=db.businessPermissions(req.company); const applications=await db.listApplicationsForCompany(req.company.id); const dashboard_insights=await db.companyDashboardInsights(req.company.id); const lockReason=!req.company.verificada?'verification_required':'paid_plan_required'; res.json({company:req.company,permissions:perms,business_rules:db.BUSINESS_RULES,metrics:dashboard_insights.metrics,saved_searches:await db.listSavedSearches(req.company.id),applications:perms.can_unlock_contacts?applications:applications.map(a=>maskApplicationContacts(a,lockReason)),jobs:await db.listCompanyJobs(req.company.id),favorites:perms.can_save_favorites?await db.listFavorites(req.company.id,req.company):[],contact_history:perms.can_unlock_contacts?await db.listContactHistory(req.company.id):[],notifications:await db.listNotifications('company',req.company.id),analytics:await db.analyticsSummary(req.company.id),dashboard_insights}); });
app.get('/api/recommendations',requireCompany,requireContactAccess,async(req,res)=>res.json({recommendations:await db.recommendProfilesForCompany(req.company.id,{region:req.query.region,licencia:req.query.licencia,job_id:req.query.job_id,limit:req.query.limit,min_score:req.query.min_score})}));

app.post('/api/events',async(req,res)=>{ const c=await db.getCompanyByToken(bearer(req)); const p=await db.getProfileByToken((req.headers['x-profile-token']||'').toString()); await db.trackEvent(clean(req.body.type||'frontend_event',60),{company_id:c?.id||null,profile_id:p?.id||null,target_type:clean(req.body.target_type||'',30),target_id:req.body.target_id||null,metadata:req.body.metadata||{}}); res.json({ok:true}); });
app.get('/api/favorites',requireCompany,requireContactAccess,async(req,res)=>res.json(await db.listFavorites(req.company.id,req.company)));
app.post('/api/favorites/:profileId',requireCompany,requireContactAccess,async(req,res)=>res.json(await db.favoriteProfile(req.company.id,req.params.profileId)));
app.delete('/api/favorites/:profileId',requireCompany,async(req,res)=>res.json(await db.removeFavorite(req.company.id,req.params.profileId)));
app.post('/api/contact-history/:profileId',requireCompany,requireContactAccess,async(req,res)=>res.json(await db.addContactHistory(req.company.id,req.params.profileId,req.body.channel||'whatsapp')));
app.get('/api/contact-history',requireCompany,requireContactAccess,async(req,res)=>res.json(await db.listContactHistory(req.company.id)));
app.get('/api/notifications',async(req,res)=>{ const c=await db.getCompanyByToken(bearer(req)); const p=await db.getProfileByToken((req.headers['x-profile-token']||'').toString()); if(c) return res.json(await db.listNotifications('company',c.id)); if(p) return res.json(await db.listNotifications('profile',p.id)); res.status(401).json({error:'Debes iniciar sesión.'}); });
app.post('/api/notifications/read',async(req,res)=>{ const c=await db.getCompanyByToken(bearer(req)); const p=await db.getProfileByToken((req.headers['x-profile-token']||'').toString()); if(c) return res.json(await db.markNotificationsRead('company',c.id)); if(p) return res.json(await db.markNotificationsRead('profile',p.id)); res.status(401).json({error:'Debes iniciar sesión.'}); });
app.get('/api/company-analytics',requireCompany,async(req,res)=>res.json(await db.analyticsSummary(req.company.id)));

app.put('/api/company-profile',requireCompany,async(req,res)=>{ try{ const bad=validateCompanyPayload(req.body); if(bad) return res.status(400).json({error:bad}); for(const f of ['nombre','rut_empresa','region','comuna','tipo_empresa','necesidad','whatsapp']) if(!req.body[f]) return res.status(400).json({error:`Falta el campo: ${f}`}); res.json(await db.updateCompanyProfile(req.company.id,req.body)); }catch(e){ const unique=String(e.message||'').includes('UNIQUE')||String(e.code||'')==='23505'; res.status(unique?409:500).json({error:unique?'Ya existe una empresa registrada con ese RUT.':'No se pudo actualizar el perfil.'}); }});
app.post('/api/company-login',rateLimit('login',8,10*60*1000),async(req,res)=>{ try{ const s=await db.loginCompany(req.body.email,req.body.password); if(!s){ await db.trackEvent('login_failed_company',{metadata:{email:req.body.email||'',ip:req.ip}}); return res.status(401).json({error:'Email o contraseña incorrectos.'}); } await db.trackEvent('login_success_company',{company_id:s.company?.id,metadata:{ip:req.ip}}); res.json(s); }catch(e){ res.status(e.code==='EMAIL_NOT_VERIFIED'?403:500).json({error:e.message||'No se pudo iniciar sesión.'}); } });
app.post('/api/companies',rateLimit('companies',20,60*60*1000),uploadCompanyDoc,uploadErrorHandler,async(req,res)=>{ try{ attachUploadedCompanyDoc(req); const bad=validateCompanyPayload(req.body); if(bad) return res.status(400).json({error:bad}); for(const f of ['nombre','razon_social','rut_empresa','region','comuna','tipo_empresa','necesidad','email','whatsapp','password']) if(!req.body[f]) return res.status(400).json({error:`Falta el campo: ${f}`}); if(!req.body.documento_empresa) return res.status(400).json({error:'Debes subir un documento de verificación de empresa en PDF, JPG o PNG.'}); req.body.verificada=false; const company=await db.createCompany(req.body); await db.trackEvent('company_registered',{company_id:company.id,metadata:{email:company.email,rut_empresa:company.rut_empresa,ip:req.ip}}); const email_verification=await createAndSendVerification(req,'company',company.id); await notifyAdminNewCompany(req,company); res.status(201).json({company,email_verification_required:true,email_delivery:email_verification?.console?'console':'email'}); }catch(e){ const msg=String(e.message||''); const code=String(e.code||''); const unique=msg.includes('UNIQUE')||code==='23505'; const rutDup=unique && msg.includes('rut_empresa'); res.status(unique?409:500).json({error:rutDup?'Ya existe una empresa registrada con ese RUT.':unique?'Ya existe una empresa con ese email o RUT.':msg||'No se pudo registrar la empresa.'}); }});
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
  if(!req.company?.verificada) return res.status(403).json({error:'Tu empresa debe estar verificada antes de activar el plan Pagado.'});
  if(!flowReady()){
    if(process.env.PAYMENT_CHECKOUT_URL) return res.json({checkout_url:process.env.PAYMENT_CHECKOUT_URL,amount:'0,5 UF',period_days:30});
    return res.status(501).json(paymentRequiredPayload());
  }
  const cfg=flowConfig();
  const amount=Number(process.env.PLAN_PAID_AMOUNT_CLP || 19990);
  const publicUrl=cfg.publicUrl || `${req.protocol}://${req.get('host')}`;
  const commerceOrder=`CL-${req.company.id}-${Date.now()}`;
  const subject=process.env.FLOW_PAYMENT_SUBJECT || 'ChoferLink - Plan Pagado 30 dias';
  const urlConfirmation=process.env.FLOW_CONFIRM_URL || `${publicUrl}/api/payments/flow/confirm`;
  const urlReturn=process.env.FLOW_RETURN_URL || `${publicUrl}/api/payments/flow/return`;
  const flow=await flowRequest('/payment/create',{commerceOrder,subject,currency:'CLP',amount,email:req.company.email,urlConfirmation,urlReturn},'POST');
  await db.createPaymentAttempt(req.company.id,{provider:'flow',amount,currency:'CLP',status:'pending',commerce_order:commerceOrder,flow_token:flow.token,flow_order:flow.flowOrder,raw_response:flow});
  const checkout_url=flow.url && flow.token ? `${flow.url}?token=${encodeURIComponent(flow.token)}` : (flow.url || null);
  res.json({provider:'flow',checkout_url,token:flow.token,commerce_order:commerceOrder,amount,currency:'CLP',period_days:30});
});

app.all('/api/payments/flow/confirm',async(req,res)=>{
  try{
    const token=req.body?.token || req.query?.token;
    const result=await confirmFlowToken(token);
    res.json({ok:true,...result});
  }catch(e){ res.status(400).json({ok:false,error:e.message || 'No se pudo confirmar el pago Flow.'}); }
});
app.all('/api/payments/flow/return',async(req,res)=>{
  try{
    const token=req.body?.token || req.query?.token;
    if(token) await confirmFlowToken(token);
  }catch(_){ /* El webhook de confirmación es la fuente principal. */ }
  res.redirect('/empresa-suscripcion.html?payment=flow');
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
app.post('/api/profiles',rateLimit('profiles',30,60*60*1000),uploadDriverDocs.fields([{name:'licencia_archivo',maxCount:1},{name:'hoja_vida_archivo',maxCount:1}]),uploadErrorHandler,async(req,res)=>{ try{ attachUploadedDriverDocs(req); if (typeof req.body.trucks === 'string') req.body.trucks = JSON.parse(req.body.trucks || '[]'); const bad=validateProfilePayload(req.body); if(bad) return res.status(400).json({error:bad}); if(req.body.email && !isEmail(req.body.email)) return res.status(400).json({error:'Email inválido.'}); if(!req.body.password || String(req.body.password).length<6) return res.status(400).json({error:'La contraseña debe tener al menos 6 caracteres.'}); for(const f of ['tipo','nombre','rut','region','comuna','experiencia','especialidad','disponibilidad','email','whatsapp','password']) if(req.body[f]===undefined||req.body[f]==='') return res.status(400).json({error:`Falta el campo: ${f}`}); if(req.body.tipo==='Chofer'&&!req.body.licencia) return res.status(400).json({error:'Falta licencia profesional.'}); if(req.body.tipo==='Chofer' && !req.body.documento_licencia) return res.status(400).json({error:'Sube la licencia de conducir en PDF, JPG o PNG.'}); if(req.body.tipo==='Chofer' && !req.body.hoja_vida_conductor) return res.status(400).json({error:'Sube la hoja de vida del conductor en PDF.'}); if(req.body.tipo==='Dueño de camión' && !(req.body.trucks||[]).some(t=>t.patente&&t.tipo)) return res.status(400).json({error:'Agrega al menos un camión con patente y tipo.'}); const created=await db.createProfile(req.body); await db.trackEvent('profile_registered',{profile_id:created.profile.id,metadata:{email:created.profile.email,tipo:created.profile.tipo,ip:req.ip}}); await createAndSendVerification(req,'profile',created.profile.id); await notifyAdminNewProfile(req,created.profile); res.status(201).json({...created,email_verification_required:true}); }catch(e){ console.error(e); const msg=String(e.message||''); res.status(msg.startsWith('Archivo rechazado')?400:500).json({error:msg.startsWith('Archivo rechazado')?msg:'No se pudo guardar el perfil.'}); }});
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
  if(!emailOk || !passOk){ await db.trackEvent('login_failed_admin',{metadata:{email:req.body.email||'',ip:req.ip}}); return res.status(401).json({error:'Email o contraseña de administrador incorrectos.'}); }
  const session = makeAdminSession();
  adminSessions.set(session,{created_at:Date.now(),email:configuredUser});
  res.json({session,admin:{email:configuredUser}});
});
app.post('/api/admin/logout', requireAdmin, async(req,res)=>{ const session=getAdminAuth(req); if(session) adminSessions.delete(session); res.json({ok:true}); });
app.get('/api/admin/summary', requireAdmin, async(_req,res)=>res.json(await db.adminSummary()));
app.get('/api/admin/audit-events', requireAdmin, async(req,res)=>res.json(await db.adminAuditEvents(req.query.limit||100)));
app.get('/api/admin/fraud-signals', requireAdmin, async(_req,res)=>res.json(await db.fraudSignals()));
app.get('/api/admin/auto-verification', requireAdmin, async(_req,res)=>res.json(await db.adminRunAutoVerification({dry_run:true})));
app.post('/api/admin/auto-verification/run', requireAdmin, async(req,res)=>res.json(await db.adminRunAutoVerification({dry_run:req.body?.dry_run!==false?true:false})));
app.get('/api/admin/companies', requireAdmin, async(req,res)=>res.json(await db.adminListCompanies({q:req.query.q,estado:req.query.estado})));
app.get('/api/admin/profiles', requireAdmin, async(req,res)=>res.json(await db.adminListProfiles({q:req.query.q,estado:req.query.estado,tipo:req.query.tipo})));
app.get('/api/admin/jobs', requireAdmin, async(_req,res)=>res.json(await db.adminListJobs()));
app.get('/api/admin/applications', requireAdmin, async(_req,res)=>res.json(await db.adminListApplications()));
app.get('/api/admin/pending-documents', requireAdmin, async(_req,res)=>res.json(await db.listPendingDocuments()));
app.patch('/api/admin/profiles/:id/verification', requireAdmin, async(req,res)=>{ try{ const allowed=['pendiente','aprobado','rechazado','vencido']; const estado=req.body.documento_estado; if(estado && !allowed.includes(estado)) return res.status(400).json({error:'Estado documental inválido.'}); const updated=await db.adminUpdateProfileVerification(req.params.id,{verificado:req.body.verificado,documento_estado:estado}); if(updated && (req.body.verificado!==undefined || estado)){ await notifyProfileVerificationResult(req,updated,(req.body.verificado===true || estado==='aprobado')?'approved':'rejected'); await db.trackEvent('admin_profile_verification_changed',{profile_id:updated.id,metadata:{verificado:req.body.verificado,documento_estado:estado}}); } res.json(updated); }catch(e){ res.status(500).json({error:'No se pudo actualizar el perfil.'}); }});
app.patch('/api/admin/companies/:id/verification', requireAdmin, async(req,res)=>{ try{ const updated=await db.adminUpdateCompanyVerification(req.params.id,{verificada:req.body.verificada,plan:req.body.plan}); if(updated && req.body.verificada!==undefined){ await notifyCompanyVerificationResult(req,updated,req.body.verificada?'approved':'rejected'); await db.trackEvent('admin_company_verification_changed',{company_id:updated.id,metadata:{verificada:req.body.verificada,plan:req.body.plan||null}}); } res.json(updated); }catch(e){ res.status(500).json({error:'No se pudo actualizar la empresa.'}); }});
app.delete('/api/admin/companies/:id', requireAdmin, async(req,res)=>{ try{ const deleted=await db.adminDeleteCompany(req.params.id); if(!deleted) return res.status(404).json({error:'Empresa no encontrada.'}); res.json({ok:true,deleted}); }catch(e){ console.error('Admin delete company error:',e); res.status(500).json({error:'No se pudo eliminar la empresa.'}); }});
app.delete('/api/admin/profiles/:id', requireAdmin, async(req,res)=>{ try{ const deleted=await db.adminDeleteProfile(req.params.id); if(!deleted) return res.status(404).json({error:'Perfil no encontrado.'}); res.json({ok:true,deleted}); }catch(e){ console.error('Admin delete profile error:',e); res.status(500).json({error:'No se pudo eliminar el perfil.'}); }});
app.get('/api/admin/profile-document/:id/:kind', requireAdmin, async(req,res)=>{ try{ const doc=await db.adminGetProfileDocument(req.params.id,req.params.kind); if(!doc?.path) return res.status(404).send('Documento no disponible.'); const full=path.join(__dirname, doc.path.replace(/^\//,'')); if(!full.startsWith(path.join(__dirname,'uploads','drivers')) || !fs.existsSync(full)) return res.status(404).send('Documento no encontrado.'); res.sendFile(full); }catch(e){ res.status(500).send('No se pudo abrir el documento.'); }});
app.get('/api/admin/company-document/:id', requireAdmin, async(req,res)=>{ try{ const doc=await db.adminGetCompanyDocument(req.params.id); if(!doc?.path) return res.status(404).send('Documento no disponible.'); const full=path.join(__dirname, doc.path.replace(/^\//,'')); if(!full.startsWith(path.join(__dirname,'uploads','companies')) || !fs.existsSync(full)) return res.status(404).send('Documento no encontrado.'); res.sendFile(full); }catch(e){ res.status(500).send('No se pudo abrir el documento.'); }});
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
