require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');
const { BakongKHQR, khqrData, MerchantInfo, SourceInfo } = require('bakong-khqr');

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const DB_FILE = path.join(__dirname, 'data', 'kvann_top_up.sqlite');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(DB_FILE);
const run = (sql, params=[]) => new Promise((resolve,reject)=>db.run(sql,params,function(err){err?reject(err):resolve({id:this.lastID,changes:this.changes});}));
const get = (sql, params=[]) => new Promise((resolve,reject)=>db.get(sql,params,(err,row)=>err?reject(err):resolve(row)));
const all = (sql, params=[]) => new Promise((resolve,reject)=>db.all(sql,params,(err,rows)=>err?reject(err):resolve(rows)));

async function initDb(){
  await run(`PRAGMA foreign_keys = ON`);
  await run(`CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS games(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    region TEXT,
    image TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS products(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    amount TEXT NOT NULL,
    price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS orders(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    server_id TEXT,
    customer_note TEXT,
    amount REAL NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    payment_status TEXT NOT NULL DEFAULT 'UNPAID',
    fulfillment_status TEXT NOT NULL DEFAULT 'WAITING_PAYMENT',
    khqr TEXT,
    khqr_md5 TEXT,
    khqr_image TEXT,
    deeplink TEXT,
    payment_tx TEXT,
    paid_at TEXT,
    fulfilled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(product_id) REFERENCES products(id),
    FOREIGN KEY(game_id) REFERENCES games(id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS audit_logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const seed = require('./data/seed.json');
  const gameCount = await get(`SELECT COUNT(*) c FROM games`);
  if (!gameCount.c) {
    for (const g of seed.games) await run(`INSERT INTO games(slug,name,category,region,image,active) VALUES(?,?,?,?,?,?)`, [g.slug,g.name,g.category,g.region,g.image,g.active]);
    for (const p of seed.products) {
      const game = await get(`SELECT id FROM games WHERE slug=?`, [p.gameSlug]);
      await run(`INSERT INTO products(game_id,name,amount,price,currency,active) VALUES(?,?,?,?,?,?)`, [game.id,p.name,p.amount,p.price,p.currency,p.active]);
    }
  }
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const existing = await get(`SELECT id FROM users WHERE email=?`, [adminEmail.toLowerCase()]);
    if (!existing) {
      const hash = await bcrypt.hash(adminPassword, 12);
      await run(`INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')`, ['KVANN TOP UP Admin',adminEmail.toLowerCase(),hash]);
      console.log(`Created admin: ${adminEmail}`);
    }
  }
}

function signToken(user){
  return jwt.sign({ id:user.id, role:user.role, email:user.email }, JWT_SECRET, {expiresIn:'7d'});
}
function setAuth(res,user){
  res.cookie('kvann_token', signToken(user), {httpOnly:true, sameSite:'lax', secure:BASE_URL.startsWith('https://'), maxAge:7*24*3600*1000});
}
function readUser(req){
  try { return jwt.verify(req.cookies.kvann_token || '', JWT_SECRET); } catch { return null; }
}
function auth(req,res,next){ const u=readUser(req); if(!u) return res.status(401).json({error:'LOGIN_REQUIRED'}); req.user=u; next(); }
function admin(req,res,next){ const u=readUser(req); if(!u || u.role!=='admin') return res.status(403).json({error:'ADMIN_REQUIRED'}); req.user=u; next(); }
async function audit(userId,action,details=''){ try{await run(`INSERT INTO audit_logs(user_id,action,details) VALUES(?,?,?)`,[userId,action,details]);}catch(e){console.error(e.message);} }
function makeOrderCode(){ return 'SSM-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(); }

async function createKhqr({amount,currency,orderCode}){
  if(!process.env.BAKONG_ACCOUNT_ID) throw new Error('BAKONG_ACCOUNT_ID is not configured');
  const cur = String(currency).toUpperCase()==='KHR' ? khqrData.currency.khr : khqrData.currency.usd;
  const optionalData = {
    currency: cur,
    amount,
    billNumber: orderCode,
    mobileNumber: process.env.MERCHANT_PHONE || undefined,
    storeLabel: 'KVANN TOP UP',
    terminalLabel: 'WEB',
    expirationTimestamp: Date.now() + Number(process.env.PAYMENT_EXPIRE_MINUTES || 10)*60*1000,
    merchantCategoryCode: '5999'
  };
  const merchantInfo = new MerchantInfo(
    process.env.BAKONG_ACCOUNT_ID,
    process.env.MERCHANT_NAME || 'KVANN TOP UP',
    process.env.MERCHANT_CITY || 'Phnom Penh',
    process.env.MERCHANT_ID || '000000000',
    process.env.ACQUIRING_BANK || 'Bakong',
    optionalData
  );
  const response = new BakongKHQR().generateMerchant(merchantInfo);
  if(!response || response.status?.code !== 0 || !response.data?.qr) throw new Error(response?.status?.message || 'KHQR generation failed');
  const qr = response.data.qr;
  const md5 = response.data.md5 || crypto.createHash('md5').update(qr).digest('hex');
  const image = await QRCode.toDataURL(qr, {width:420, margin:2, errorCorrectionLevel:'M'});
  let deeplink = null;
  if(process.env.BAKONG_TOKEN){
    try{
      const source = new SourceInfo(`${BASE_URL}/assets/logo.svg`, 'KVANN TOP UP', `${BASE_URL}/order.html?code=${encodeURIComponent(orderCode)}`);
      const dl = await BakongKHQR.generateDeepLink(`${process.env.BAKONG_API_BASE || 'https://api-bakong.nbc.gov.kh'}/v1/generate_deeplink_by_qr`, qr, source);
      deeplink = dl?.data?.shortLink || null;
    }catch(e){ console.warn('Deeplink unavailable:',e.message); }
  }
  return {qr,md5,image,deeplink};
}

async function checkBakong(md5){
  if(!process.env.BAKONG_TOKEN) throw new Error('BAKONG_TOKEN is not configured');
  const base = process.env.BAKONG_API_BASE || 'https://api-bakong.nbc.gov.kh';
  const r = await fetch(`${base}/v1/check_transaction_by_md5`, {
    method:'POST', headers:{'Authorization':`Bearer ${process.env.BAKONG_TOKEN}`,'Content-Type':'application/json'}, body:JSON.stringify({md5})
  });
  const data = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data?.responseMessage || `Bakong HTTP ${r.status}`);
  return data;
}

function normalizePaymentResult(api){
  const data = api?.data || {};
  const code = api?.responseCode;
  const status = String(data?.status || data?.transactionStatus || '').toUpperCase();
  const success = code === 0 && (status === 'SUCCESS' || status === 'PAID' || !!data?.hash || !!data?.transactionHash);
  return {success,data};
}

app.get('/api/health',(req,res)=>res.json({ok:true,time:new Date().toISOString()}));
app.get('/api/config',(req,res)=>res.json({storeName:process.env.MERCHANT_NAME||'KVANN TOP UP', currency:process.env.STORE_CURRENCY||'USD', paymentConfigured:!!process.env.BAKONG_ACCOUNT_ID && !!process.env.BAKONG_TOKEN}));

app.get('/api/games', async (req,res)=>{
  const q=(req.query.q||'').trim();
  const games=await all(`SELECT * FROM games WHERE active=1 AND (name LIKE ? OR category LIKE ?) ORDER BY id`, [`%${q}%`,`%${q}%`]);
  for(const g of games) g.products=await all(`SELECT * FROM products WHERE game_id=? AND active=1 ORDER BY price,id`,[g.id]);
  res.json(games);
});

app.post('/api/auth/register', async (req,res)=>{
  try{
    const {name,email,password}=req.body;
    if(!name||!email||!password||password.length<6) return res.status(400).json({error:'NAME_EMAIL_PASSWORD_REQUIRED'});
    const e=email.trim().toLowerCase();
    if(await get(`SELECT id FROM users WHERE email=?`,[e])) return res.status(409).json({error:'EMAIL_EXISTS'});
    const hash=await bcrypt.hash(password,12);
    const result=await run(`INSERT INTO users(name,email,password_hash) VALUES(?,?,?)`,[name.trim(),e,hash]);
    const user=await get(`SELECT id,name,email,role FROM users WHERE id=?`,[result.id]); setAuth(res,user); await audit(user.id,'REGISTER'); res.json({user});
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/auth/login', async (req,res)=>{
  try{
    const {email,password}=req.body; const user=await get(`SELECT * FROM users WHERE email=?`,[(email||'').trim().toLowerCase()]);
    if(!user || !(await bcrypt.compare(password||'',user.password_hash))) return res.status(401).json({error:'INVALID_LOGIN'});
    setAuth(res,user); await audit(user.id,'LOGIN'); res.json({user:{id:user.id,name:user.name,email:user.email,role:user.role}});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('kvann_token');res.json({ok:true});});
app.get('/api/auth/me',(req,res)=>{const u=readUser(req); if(!u)return res.json({user:null}); get(`SELECT id,name,email,role FROM users WHERE id=?`,[u.id]).then(user=>res.json({user}));});

app.post('/api/orders', auth, async (req,res)=>{
  try{
    const {productId,playerId,serverId,customerNote}=req.body;
    if(!productId||!playerId) return res.status(400).json({error:'PRODUCT_AND_PLAYER_ID_REQUIRED'});
    const p=await get(`SELECT p.*,g.id game_id,g.name game_name,g.slug game_slug FROM products p JOIN games g ON g.id=p.game_id WHERE p.id=? AND p.active=1 AND g.active=1`,[productId]);
    if(!p)return res.status(404).json({error:'PRODUCT_NOT_FOUND'});
    const code=makeOrderCode(); const qr=await createKhqr({amount:p.price,currency:p.currency,orderCode:code});
    const r=await run(`INSERT INTO orders(order_code,user_id,product_id,game_id,player_id,server_id,customer_note,amount,currency,khqr,khqr_md5,khqr_image,deeplink) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,[code,req.user.id,p.id,p.game_id,playerId.trim(),serverId?.trim()||null,customerNote||null,p.price,p.currency,qr.qr,qr.md5,qr.image,qr.deeplink]);
    const order=await getOrder(r.id); await audit(req.user.id,'CREATE_ORDER',code); res.status(201).json(order);
  }catch(e){console.error(e);res.status(500).json({error:e.message});}
});

async function getOrder(idOrCode){
  return get(`SELECT o.*,p.name product_name,g.name game_name,u.name customer_name,u.email customer_email FROM orders o JOIN products p ON p.id=o.product_id JOIN games g ON g.id=o.game_id JOIN users u ON u.id=o.user_id WHERE o.id=? OR o.order_code=?`,[idOrCode,idOrCode]);
}
function publicOrder(o){ if(!o)return null; return {...o,khqr:o.khqr,khqr_md5:o.khqr_md5,khqr_image:o.khqr_image,deeplink:o.deeplink}; }

app.get('/api/orders/:code', auth, async(req,res)=>{
  const o=await getOrder(req.params.code); if(!o)return res.status(404).json({error:'ORDER_NOT_FOUND'});
  if(o.user_id!==req.user.id && req.user.role!=='admin')return res.status(403).json({error:'FORBIDDEN'});
  res.json(publicOrder(o));
});

app.post('/api/orders/:code/check-payment', auth, async(req,res)=>{
  try{
    const o=await getOrder(req.params.code); if(!o)return res.status(404).json({error:'ORDER_NOT_FOUND'});
    if(o.user_id!==req.user.id && req.user.role!=='admin')return res.status(403).json({error:'FORBIDDEN'});
    if(o.payment_status==='PAID')return res.json(publicOrder(o));
    const api=await checkBakong(o.khqr_md5); const result=normalizePaymentResult(api);
    if(result.success){
      const d=result.data||{};
      const txHash=d.hash || d.transactionHash || d.txHash || null;
      const paidAmount=Number(d.amount ?? d.transactionAmount ?? o.amount);
      const paidCurrency=String(d.currency ?? d.transactionCurrency ?? o.currency).toUpperCase();
      const expectedCurrency=String(o.currency).toUpperCase();
      if(Math.abs(paidAmount-Number(o.amount))>0.0001 || paidCurrency!==expectedCurrency) return res.status(409).json({error:'PAYMENT_AMOUNT_MISMATCH'});
      await run(`UPDATE orders SET payment_status='PAID',status='PAID',fulfillment_status='READY_TO_FULFILL',payment_tx=?,paid_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[txHash,o.id]);
      await audit(req.user.id,'PAYMENT_CONFIRMED',o.order_code);
    }
    res.json(publicOrder(await getOrder(o.id)));
  }catch(e){res.status(503).json({error:e.message});}
});

// ===== Admin =====
app.get('/api/admin/orders',admin,async(req,res)=>{
  const status=req.query.status||'';
  const sql=status?`SELECT o.*,p.name product_name,g.name game_name,u.name customer_name,u.email customer_email FROM orders o JOIN products p ON p.id=o.product_id JOIN games g ON g.id=o.game_id JOIN users u ON u.id=o.user_id WHERE o.status=? ORDER BY o.id DESC`:`SELECT o.*,p.name product_name,g.name game_name,u.name customer_name,u.email customer_email FROM orders o JOIN products p ON p.id=o.product_id JOIN games g ON g.id=o.game_id JOIN users u ON u.id=o.user_id ORDER BY o.id DESC`;
  res.json(await all(sql,status?[status]:[]));
});
app.patch('/api/admin/orders/:id',admin,async(req,res)=>{
  const {status,fulfillmentStatus}=req.body; const allowed=['PENDING_PAYMENT','PAID','PROCESSING','COMPLETED','CANCELLED','REFUNDED'];
  if(status&&!allowed.includes(status))return res.status(400).json({error:'BAD_STATUS'});
  const o=await getOrder(req.params.id);if(!o)return res.status(404).json({error:'ORDER_NOT_FOUND'});
  await run(`UPDATE orders SET status=COALESCE(?,status), fulfillment_status=COALESCE(?,fulfillment_status), fulfilled_at=CASE WHEN ?='COMPLETED' THEN CURRENT_TIMESTAMP ELSE fulfilled_at END, updated_at=CURRENT_TIMESTAMP WHERE id=?`,[status||null,fulfillmentStatus||null,status||'',o.id]);
  await audit(req.user.id,'ADMIN_ORDER_UPDATE',`${o.order_code}:${status||''}`);res.json(await getOrder(o.id));
});
app.get('/api/admin/stats',admin,async(req,res)=>{
  const total=await get(`SELECT COUNT(*) c FROM orders`); const paid=await get(`SELECT COUNT(*) c FROM orders WHERE payment_status='PAID'`); const revenue=await get(`SELECT COALESCE(SUM(amount),0) n FROM orders WHERE payment_status='PAID'`); const customers=await get(`SELECT COUNT(*) c FROM users WHERE role='customer'`); res.json({totalOrders:total.c,paidOrders:paid.c,revenue:revenue.n,customers:customers.c});
});
app.post('/api/admin/games',admin,async(req,res)=>{try{const {slug,name,category,region,image}=req.body;if(!slug||!name)return res.status(400).json({error:'SLUG_AND_NAME_REQUIRED'});const r=await run(`INSERT INTO games(slug,name,category,region,image) VALUES(?,?,?,?,?)`,[slug,name,category||'',region||'',image||'/assets/logo.svg']);res.status(201).json(await get(`SELECT * FROM games WHERE id=?`,[r.id]));}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/admin/products',admin,async(req,res)=>{try{const {gameId,name,amount,price,currency}=req.body;if(!gameId||!name||!amount||!price)return res.status(400).json({error:'REQUIRED_FIELDS'});const r=await run(`INSERT INTO products(game_id,name,amount,price,currency) VALUES(?,?,?,?,?)`,[gameId,name,amount,Number(price),currency||'USD']);res.status(201).json(await get(`SELECT * FROM products WHERE id=?`,[r.id]));}catch(e){res.status(400).json({error:e.message});}});
app.get('/api/admin/games',admin,async(req,res)=>{const games=await all(`SELECT * FROM games ORDER BY id DESC`);for(const g of games)g.products=await all(`SELECT * FROM products WHERE game_id=? ORDER BY id DESC`,[g.id]);res.json(games);});

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'SERVER_ERROR'});});

initDb().then(()=>app.listen(PORT,()=>console.log(`KVANN TOP UP v2 running on ${BASE_URL}`))).catch(e=>{console.error(e);process.exit(1);});
