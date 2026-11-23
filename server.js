require("dotenv").config();
const express = require("express");
const cookieSession = require("cookie-session");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const app = express();
const localDb = new Database("casearena.db");
localDb.pragma("journal_mode = WAL");
localDb.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user',
 balance INTEGER NOT NULL DEFAULT 1000,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 google_sub TEXT,
 banned INTEGER NOT NULL DEFAULT 0,
 session_version INTEGER NOT NULL DEFAULT 0,
 last_hourly_claim BIGINT NOT NULL DEFAULT 0,
 lunacy_redeemed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inventory (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 item_name TEXT NOT NULL,
 item_value INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS activity (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 message TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
const localUserColumns = localDb.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!localUserColumns.includes("google_sub")) localDb.exec("ALTER TABLE users ADD COLUMN google_sub TEXT");
if (!localUserColumns.includes("banned")) localDb.exec("ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0");
if (!localUserColumns.includes("session_version")) localDb.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
if (!localUserColumns.includes("last_hourly_claim")) localDb.exec("ALTER TABLE users ADD COLUMN last_hourly_claim BIGINT NOT NULL DEFAULT 0");
if (!localUserColumns.includes("lunacy_redeemed")) localDb.exec("ALTER TABLE users ADD COLUMN lunacy_redeemed INTEGER NOT NULL DEFAULT 0");

const { Pool } = require("pg");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for persistent CaseArena storage");
const pool = new Pool({
 connectionString: process.env.DATABASE_URL,
 ssl: { rejectUnauthorized: false },
 max: 5,
 idleTimeoutMillis: 30000,
 connectionTimeoutMillis: 15000
});
let writeQueue = Promise.resolve();
let writeError = null;
let capturedWrites = null;

function toPgSql(sql) {
 let index = 0;
 return sql.replace(/\?/g, () => "$" + (++index));
}
function enqueueWrites(writes) {
 if (!writes.length) return;
 writeQueue = writeQueue.then(async () => {
   const client = await pool.connect();
   try {
     if (writes.length > 1) await client.query("BEGIN");
     for (const item of writes) await client.query(item.sql, item.params);
     if (writes.length > 1) await client.query("COMMIT");
     writeError = null;
   } catch (error) {
     if (writes.length > 1) await client.query("ROLLBACK").catch(() => {});
     writeError = error;
     console.error("Postgres write failed:", error.message);
   } finally {
     client.release();
   }
 });
}
function mirrorWrite(sql, params, result) {
 const insert = sql.match(/^INSERT\s+INTO\s+([a-z_]+)\s*\(([^)]+)\)\s*VALUES\s*\(/i);
 let pgStatement = toPgSql(sql);
 let pgParams = params;
 if (insert && result && result.lastInsertRowid != null) {
   const table = insert[1];
   const columns = insert[2].trim();
   pgStatement = "INSERT INTO " + table + " (id, " + columns + ") VALUES (" +
     ["$1", ...params.map((_, i) => "$" + (i + 2))].join(",") + ")";
   pgParams = [Number(result.lastInsertRowid), ...params];
 }
 const item = { sql: pgStatement, params: pgParams };
 if (capturedWrites) capturedWrites.push(item);
 else enqueueWrites([item]);
}
const db = {
 pragma: (...args) => localDb.pragma(...args),
 exec: (...args) => localDb.exec(...args),
 prepare(sql) {
   const statement = localDb.prepare(sql);
   return {
     get: (...params) => statement.get(...params),
     all: (...params) => statement.all(...params),
     run: (...params) => {
       const result = statement.run(...params);
       mirrorWrite(sql, params, result);
       return result;
     }
   };
 },
 transaction(callback) {
   const localTransaction = localDb.transaction(callback);
   return (...args) => {
     const previousCapture = capturedWrites;
     const writes = [];
     capturedWrites = writes;
     try {
       const result = localTransaction(...args);
       capturedWrites = previousCapture;
       if (previousCapture) previousCapture.push(...writes);
       else enqueueWrites(writes);
       return result;
     } catch (error) {
       capturedWrites = previousCapture;
       throw error;
     }
   };
 }
};

async function initializePersistentDatabase() {
 const sqlTimestamp = value => value instanceof Date ? value.toISOString() : value;
 await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS banned INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_hourly_claim BIGINT NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS lunacy_redeemed INTEGER NOT NULL DEFAULT 0");
 const [users, inventory, activity] = await Promise.all([
   pool.query("SELECT * FROM users ORDER BY id"),
   pool.query("SELECT * FROM inventory ORDER BY id"),
   pool.query("SELECT * FROM activity ORDER BY id")
 ]);
 const remoteHasData = users.rowCount + inventory.rowCount + activity.rowCount > 0;
 if (remoteHasData) {
   localDb.exec("DELETE FROM inventory; DELETE FROM activity; DELETE FROM users;");
   for (const u of users.rows) localDb.prepare(
     "INSERT INTO users(id,username,password_hash,role,balance,created_at,google_sub,banned,session_version,last_hourly_claim,lunacy_redeemed) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
   ).run(u.id,u.username,u.password_hash,u.role,u.balance,sqlTimestamp(u.created_at),u.google_sub,u.banned||0,u.session_version||0,u.last_hourly_claim||0,u.lunacy_redeemed||0);
   for (const item of inventory.rows) localDb.prepare(
     "INSERT INTO inventory(id,user_id,item_name,item_value,created_at) VALUES(?,?,?,?,?)"
   ).run(item.id,item.user_id,item.item_name,item.item_value,sqlTimestamp(item.created_at));
   for (const item of activity.rows) localDb.prepare(
     "INSERT INTO activity(id,user_id,message,created_at) VALUES(?,?,?,?)"
   ).run(item.id,item.user_id,item.message,sqlTimestamp(item.created_at));
 } else {
   const localUsers = localDb.prepare("SELECT * FROM users ORDER BY id").all();
   const localInventory = localDb.prepare("SELECT * FROM inventory ORDER BY id").all();
   const localActivity = localDb.prepare("SELECT * FROM activity ORDER BY id").all();
   for (const u of localUsers) await pool.query(
     "INSERT INTO users(id,username,password_hash,role,balance,created_at,google_sub,banned,session_version,last_hourly_claim,lunacy_redeemed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING",
     [u.id,u.username,u.password_hash,u.role,u.balance,u.created_at,u.google_sub,u.banned||0,u.session_version||0,u.last_hourly_claim||0,u.lunacy_redeemed||0]
   );
   for (const item of localInventory) await pool.query(
     "INSERT INTO inventory(id,user_id,item_name,item_value,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",
     [item.id,item.user_id,item.item_name,item.item_value,item.created_at]
   );
   for (const item of localActivity) await pool.query(
     "INSERT INTO activity(id,user_id,message,created_at) VALUES($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
     [item.id,item.user_id,item.message,item.created_at]
   );
 }
 for (const table of ["users","inventory","activity"]) {
   await pool.query("SELECT setval(pg_get_serial_sequence($1,'id'), GREATEST(COALESCE((SELECT MAX(id) FROM " + table + "),1),1), true)", [table]);
 }
 console.log("Persistent PostgreSQL storage initialized", { users: users.rowCount, inventory: inventory.rowCount, activity: activity.rowCount, importedLocal: !remoteHasData });
}
async function flushWrites() {
 await writeQueue;
 if (writeError) throw writeError;
}
const ROLE_ORDER = ["user","moderator","admin","senior_admin","deputy_head_admin","head_admin","owner"];
const ROLE_LABELS = {user:"Игрок",moderator:"Модератор",admin:"Администратор",senior_admin:"Старший администратор",deputy_head_admin:"ЗГА",head_admin:"Главный администратор",owner:"Владелец"};
const roleRank = role => { const rank=ROLE_ORDER.indexOf(role); return rank<0?0:rank; };
const OWNER_USERNAME = (process.env.OWNER_USERNAME || "").trim().toLowerCase();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "";
const OWNER_RESET_PASSWORD = process.env.OWNER_RESET_PASSWORD === "true";
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({limit:"30kb"}));
app.use((req,res,next) => {
 const originalJson = res.json.bind(res);
 // Do not hold every API response while PostgreSQL mirror writes are pending.
 // SQLite is the request-time store; mirror writes continue asynchronously.
 res.json = (payload) => {
   if (writeError) {
     res.status(503);
     return originalJson({error:"Хранилище временно недоступно. Попробуйте ещё раз."});
   }
   return originalJson(payload);
 };
 next();
});
app.use(cookieSession({
  name: "casearena_session",
  keys: [process.env.SESSION_SECRET || "casearena-stable-cookie-key-change-in-render"],
  maxAge: 1000 * 60 * 60 * 24 * 30,
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production"
}));
app.use(passport.initialize());
const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
if (googleConfigured) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/callback"
  }, (accessToken, refreshToken, profile, done) => {
    try {
      const linked = db.prepare("SELECT id,username,role,balance FROM users WHERE google_sub=?").get(profile.id);
      if (linked) return done(null, { existing: true, user: linked });
      return done(null, { existing: false, googleSub: profile.id, email: (profile.emails && profile.emails[0] && profile.emails[0].value) || null });
    } catch (err) { return done(err); }
  }));
}
const authLimiter = rateLimit({windowMs: 15*60*1000, limit: 30, standardHeaders: true, legacyHeaders: false});
app.use(express.static(path.join(__dirname, "public")));

const userView = u => ({id:u.id, username:u.username, role:u.role, balance:u.balance});
function current(req) {
  if (!req.session || !req.session.userId) return null;
  const u=db.prepare("SELECT id,username,role,balance,banned,session_version FROM users WHERE id=?").get(req.session.userId);
  if (!u || u.banned) return null;
  if (req.session.sessionVersion === undefined) return null;
  if (Number(req.session.sessionVersion)!==Number(u.session_version)) return null;
  if (OWNER_USERNAME && u.username.toLowerCase()===OWNER_USERNAME) u.role="owner";
  return u;
}
function requireAuth(req,res,next) {
  if (!current(req)) return res.status(401).json({error:"Сессия завершена. Войдите снова."});
  next();
}
function requireOwner(req,res,next) {
  const u=current(req);
  if (!u || u.role !== "owner" || (OWNER_USERNAME && u.username.toLowerCase()!==OWNER_USERNAME)) return res.status(403).json({error:"Только владелец может выполнить это действие"});
  next();
}
function requireStaff(req,res,next) {
  const u=current(req);
  if (!u || roleRank(u.role)<1) return res.status(403).json({error:"Недостаточно прав"});
  next();
}
function ownerShield(target) {
  return target && (target.role==="owner" || (OWNER_USERNAME && target.username.toLowerCase()===OWNER_USERNAME));
}
function log(userId,message) {
  db.prepare("INSERT INTO activity(user_id,message) VALUES(?,?)").run(userId,message);
}

app.get("/auth/google", (req,res,next) => {
  if (!googleConfigured) return res.status(503).send("Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.");
  passport.authenticate("google", { scope: ["profile", "email"], session: false })(req,res,next);
});
app.get("/auth/google/callback", (req,res,next) => {
  if (!googleConfigured) return res.redirect("/?google=unavailable");
  passport.authenticate("google", { session: false }, (err, result) => {
    if (err || !result) return res.redirect("/?google=error");
    if (result.existing) {
      req.session = req.session || {};
      req.session.userId = result.user.id;
      delete req.session.pendingGoogle;
      return res.redirect("/");
    }
    req.session = req.session || {};
    req.session.pendingGoogle = { googleSub: result.googleSub, email: result.email };
    return res.redirect("/?chooseNick=1");
  })(req,res,next);
});
app.get("/api/google/status", (req,res) => res.json({ configured: googleConfigured, pending: Boolean(req.session && req.session.pendingGoogle) }));
app.post("/api/google/complete-nickname", authLimiter, (req,res) => {
  const pending = req.session && req.session.pendingGoogle;
  if (!pending) return res.status(400).json({error:"Сначала войдите через Google"});
  const username = String(req.body.username || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({error:"Ник: 3–20 символов, латиница, цифры и _"});
  if (username === OWNER_USERNAME) return res.status(409).json({error:"Этот ник зарезервирован"});
  try {
    const placeholderHash = bcrypt.hashSync(require("crypto").randomBytes(48).toString("hex"), 12);
    const info = db.prepare("INSERT INTO users(username,password_hash,google_sub,balance,last_hourly_claim) VALUES(?,?,?,?,?)")
      .run(username, placeholderHash, pending.googleSub, 10000, Math.floor(Date.now()/1000));
    req.session = req.session || {};
    req.session = req.session || {};
 req.session.userId = info.lastInsertRowid;
    req.session.sessionVersion = 0;
    delete req.session.pendingGoogle;
    log(info.lastInsertRowid, "Аккаунт создан через Google");
    res.json({user:userView(current(req))});
  } catch(e) { res.status(409).json({error:"Этот ник уже занят"}); }
});

app.get("/api/activity",requireAuth,(req,res)=>{const u=current(req);res.json(db.prepare("SELECT message,created_at FROM activity WHERE user_id=? ORDER BY id DESC LIMIT 12").all(u.id));});

app.get("/api/me",(req,res)=> {
  const u=current(req);
  if (!u) return res.json({user:null});
  const items=db.prepare("SELECT id,item_name,item_value,created_at FROM inventory WHERE user_id=? ORDER BY id DESC").all(u.id);
  res.json({user:userView(u),inventory:items});
});
app.post("/api/register",authLimiter,async(req,res)=>{
  const username=String(req.body.username||"").trim().toLowerCase();
  const password=String(req.body.password||"");
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({error:"Ник: 3–20 символов, латиница, цифры и _"});
  if (password.length<10 || password.length>100) return res.status(400).json({error:"Пароль должен содержать от 10 до 100 символов"});
  if (username===OWNER_USERNAME) return res.status(409).json({error:"Этот ник зарезервирован"});
  try {
    const hash=await bcrypt.hash(password,12);
    const info=db.prepare("INSERT INTO users(username,password_hash,balance,last_hourly_claim) VALUES(?,?,?,?)").run(username,hash,10000,Math.floor(Date.now()/1000));
 req.session.userId = info.lastInsertRowid;
    req.session.sessionVersion = 0;
log(info.lastInsertRowid, "Создан аккаунт");

res.json({user:userView(current(req))});
  } catch(e) { res.status(409).json({error:"Такой ник уже занят"}); }
});
app.post("/api/login",authLimiter,async(req,res)=>{
  const username=String(req.body.username||"").trim().toLowerCase();
  const password=String(req.body.password||"");
  const u=db.prepare("SELECT * FROM users WHERE username=?").get(username);
  if (!u || !(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({error:"Неверный ник или пароль"});
  if (u.banned) return res.status(403).json({error:"Ваш аккаунт заблокирован администрацией"});
  req.session = req.session || {};
  req.session.userId = u.id;
  req.session.sessionVersion = u.session_version || 0;

res.json({user:userView(u)});
});
app.post("/api/logout",(req,res)=>{req.session=null;res.json({ok:true});});

app.get("/api/bonus/status",requireAuth,(req,res)=>{
 const u=db.prepare("SELECT balance,last_hourly_claim,lunacy_redeemed FROM users WHERE id=?").get(current(req).id);
 const now=Math.floor(Date.now()/1000), readyAt=Number(u.last_hourly_claim||0)+3600;
 res.json({balance:u.balance,hourlyReady:now>=readyAt,hourlyReadyAt:readyAt,lunacyRedeemed:!!u.lunacy_redeemed});
});
app.post("/api/bonus/hourly",requireAuth,(req,res)=>{
 const u=current(req),now=Math.floor(Date.now()/1000);
 try{
  const claim=db.transaction(()=>{
   const row=db.prepare("SELECT balance,last_hourly_claim FROM users WHERE id=?").get(u.id);
   if(now<Number(row.last_hourly_claim||0)+3600)throw new Error("Бесплатное пополнение доступно один раз в час");
   db.prepare("UPDATE users SET balance=balance+10000,last_hourly_claim=? WHERE id=?").run(now,u.id);
   log(u.id,"Получено бесплатное пополнение +10 000 CR");
   return db.prepare("SELECT balance FROM users WHERE id=?").get(u.id).balance;
  });
  const balance=claim();res.json({ok:true,balance,amount:10000});
 }catch(e){res.status(400).json({error:e.message})}
});
app.post("/api/promo/redeem",requireAuth,(req,res)=>{
 const code=String(req.body.code||"").trim().toUpperCase();
 if(code!=="LUNACY")return res.status(400).json({error:"Промокод не найден"});
 const u=current(req);
 try{
  const redeem=db.transaction(()=>{
   const row=db.prepare("SELECT lunacy_redeemed FROM users WHERE id=?").get(u.id);
   if(row.lunacy_redeemed)throw new Error("Ты уже активировал этот промокод");
   db.prepare("UPDATE users SET balance=balance+10000,lunacy_redeemed=1 WHERE id=?").run(u.id);
   log(u.id,"Активирован промокод LUNACY (+10 000 CR)");
   return db.prepare("SELECT balance FROM users WHERE id=?").get(u.id).balance;
  });
  res.json({ok:true,balance:redeem(),amount:10000});
 }catch(e){res.status(400).json({error:e.message})}
});


const cases=[
 {id:"starter",name:"РАЗМИНКА",subtitle:"Начни собирать инвентарь",price:79,items:[["Glock-18 | Candy Apple",45,68],["MP9 | Capillary",65,23],["P250 | Sand Dune",85,7],["USP-S | Ticket to Hell",120,1.7],["AK-47 | Elite Build",190,0.3]]},
 {id:"dust",name:"DUST II",subtitle:"Классика легендарной карты",price:179,items:[["Desert Eagle | Bronze Deco",95,68],["AWP | Atheris",220,23],["AK-47 | Slate",360,7],["M4A4 | Desolate Space",590,1.7],["USP-S | Neo-Noir",880,0.3]]},
 {id:"neon",name:"НЕОНОВЫЙ",subtitle:"Яркие цвета и контраст",price:349,items:[["Glock-18 | Vogue",180,68],["MP9 | Food Chain",290,23],["AK-47 | Neon Rider",980,7],["AWP | Neo-Noir",1450,1.7],["M4A1-S | Printstream",2350,0.3]]},
 {id:"inferno",name:"INFERNO",subtitle:"Огненная коллекция",price:599,items:[["AK-47 | Redline",720,68],["AWP | Wildfire",1250,23],["M4A4 | The Emperor",1750,7],["Desert Eagle | Blaze",4200,1.7],["AK-47 | Bloodsport",5100,0.3]]},
 {id:"sniper",name:"СНАЙПЕРСКИЙ",subtitle:"Только точные попадания",price:899,items:[["SSG 08 | Dragonfire",420,68],["AWP | Asiimov",1850,23],["AWP | Hyper Beast",2200,7],["AWP | Containment Breach",3900,1.7],["AWP | Dragon Lore",25000,0.3]]},
 {id:"royal",name:"КОРОЛЕВСКИЙ",subtitle:"Редкие и дорогие предметы",price:1499,items:[["M4A1-S | Printstream",2350,68],["AK-47 | Fire Serpent",9800,23],["★ Huntsman Knife | Doppler",12500,7],["★ Karambit | Doppler",38500,1.7],["★ Butterfly Knife | Fade",62000,0.3]]},
 {id:"knife",name:"ОХОТА ЗА НОЖОМ",subtitle:"Кейс для любителей ножей",price:2499,items:[["★ Navaja Knife | Fade",7500,68],["★ Shadow Daggers | Doppler",9800,23],["★ Huntsman Knife | Doppler",12500,7],["★ Karambit | Fade",55000,1.7],["★ Butterfly Knife | Fade",62000,0.3]]},
 {id:"elite",name:"ЭЛИТА",subtitle:"Максимальный риск и награда",price:4999,items:[["★ Bayonet | Doppler",32000,68],["★ M9 Bayonet | Crimson Web",41000,23],["★ Karambit | Doppler",38500,7],["★ Butterfly Knife | Fade",62000,1.7],["★ Karambit | Sapphire",115000,0.3]]}
 ,{id:"viper",name:"VIPER",subtitle:"Ядовитая подборка редких скинов",price:799,cover:"AK-47 | The Empress",items:[["AWP | Fever Dream",340,58],["AK-47 | The Empress",6900,29],["★ Bowie Knife | Doppler",17500,10],["★ Talon Knife | Fade",42000,2.5],["★ Butterfly Knife | Fade",62000,0.5]]},
 {id:"dragon",name:"DRAGON LORE",subtitle:"Охота за легендарным AWP",price:2799,cover:"AWP | Dragon Lore",items:[["AWP | Asiimov",1850,60],["AWP | Hyper Beast",2200,27],["AWP | Containment Breach",3900,10],["AWP | Dragon Lore",25000,2.7],["★ Karambit | Sapphire",115000,0.3]]},
 {id:"doppler",name:"DOPPLER",subtitle:"Ножи с редкими фазами",price:4499,cover:"★ Karambit | Doppler",items:[["★ Navaja Knife | Fade",7500,55],["★ Huntsman Knife | Doppler",12500,29],["★ Flip Knife | Gamma Doppler",28000,12],["★ Karambit | Doppler",38500,3.5],["★ Karambit | Sapphire",115000,0.5]]},
 {id:"gloves",name:"GLOVE CASE",subtitle:"Перчатки и редкие ножи",price:3499,cover:"★ Sport Gloves | Vice",items:[["★ Driver Gloves | Crimson Weave",14500,57],["★ Specialist Gloves | Fade",22000,28],["★ Sport Gloves | Vice",48000,11],["★ Butterfly Knife | Fade",62000,3.5],["★ Karambit | Sapphire",115000,0.5]]},
 {id:"blackpearl",name:"BLACK PEARL",subtitle:"Максимальная редкость и риск",price:7999,cover:"★ Butterfly Knife | Doppler",items:[["★ Bowie Knife | Doppler",17500,58],["★ Skeleton Knife | Slaughter",33000,27],["★ M9 Bayonet | Crimson Web",41000,11],["★ Butterfly Knife | Doppler",85000,3.5],["★ Karambit | Sapphire",115000,0.5]]}
,{id:"ice-dragon",name:"ЛЕДЯНОЙ ДРАКОН",subtitle:"Ледяные редкости и холодная сталь",price:129,theme:"ice",cover:"AWP | Gungnir",items:[["AWP | Atheris",220,48],["AK-47 | Ice Coaled",520,30],["AWP | Oni Taiji",6500,15],["AWP | Gungnir",95000,6.5],["★ Karambit | Sapphire",115000,0.5]]}
,{id:"cyberpunk",name:"КИБЕРПАНК",subtitle:"Неоновые пушки большого города",price:249,theme:"cyber",cover:"AK-47 | Neon Rider",items:[["MP9 | Food Chain",290,45],["AK-47 | Neon Rider",980,32],["M4A4 | Neo-Noir",2250,17],["AK-47 | X-Ray",42000,5.5],["★ Butterfly Knife | Fade",62000,0.5]]}
,{id:"gold-hour",name:"ЗОЛОТОЙ ЧАС",subtitle:"Золото, блеск и дорогие дропы",price:699,theme:"gold",cover:"AK-47 | Gold Arabesque",items:[["Desert Eagle | Bronze Deco",95,45],["Desert Eagle | Blaze",4200,35],["AK-47 | Gold Arabesque",68000,15],["★ Karambit | Tiger Tooth",52000,4.5],["★ Butterfly Knife | Fade",62000,0.5]]}
,{id:"phoenix",name:"ФЕНИКС",subtitle:"Возвращение легендарных скинов",price:549,theme:"fire",cover:"M4A4 | Howl",items:[["AK-47 | Redline",720,45],["AWP | Wildfire",1250,32],["M4A4 | The Emperor",1750,17],["M4A4 | Howl",125000,5.5],["★ Karambit | Sapphire",115000,0.5]]}
,{id:"arctic",name:"АРКТИКА",subtitle:"Холодная коллекция для точных",price:699,theme:"arctic",cover:"AWP | Medusa",items:[["AWP | Fever Dream",340,48],["AWP | Hyper Beast",2200,30],["AWP | Medusa",78000,16],["AWP | Gungnir",95000,5.5],["★ M9 Bayonet | Fade",74000,0.5]]}
,{id:"steel",name:"СТАЛЬНОЙ ХАРАКТЕР",subtitle:"Проверенные автоматы и редкие ножи",price:899,theme:"steel",cover:"AK-47 | Vulcan",items:[["AK-47 | Slate",360,45],["AK-47 | Asiimov",1650,32],["AK-47 | Vulcan",22000,17],["AK-47 | Wild Lotus",110000,5.5],["★ Butterfly Knife | Doppler",85000,0.5]]}
,{id:"blackout",name:"BLACKOUT",subtitle:"Тёмные скины и дорогие ножи",price:1199,theme:"black",cover:"AWP | Fade",items:[["USP-S | Cortex",260,48],["M4A1-S | Printstream",2350,30],["AWP | Fade",52000,16],["★ Karambit | Doppler",38500,5.5],["★ Karambit | Sapphire",115000,0.5]]}
,{id:"glitch",name:"ГЛИТЧ",subtitle:"Цифровой хаос и яркие расцветки",price:1499,theme:"glitch",cover:"M4A1-S | Player Two",items:[["MAC-10 | Disco Tech",420,45],["M4A1-S | Player Two",3800,32],["AWP | Oni Taiji",6500,17],["AK-47 | X-Ray",42000,5.5],["★ Butterfly Knife | Marble Fade",72000,0.5]]}
,{id:"emerald",name:"ИЗУМРУДНЫЙ",subtitle:"Зелёные оттенки и редкие находки",price:1999,theme:"emerald",cover:"AK-47 | Wild Lotus",items:[["AWP | Atheris",220,44],["AK-47 | The Empress",6900,34],["AK-47 | Wild Lotus",110000,16],["★ Karambit | Gamma Doppler",92000,5.5],["★ Karambit | Sapphire",115000,0.5]]}
,{id:"ruby",name:"РУБИНОВЫЙ",subtitle:"Красная коллекция премиум-класса",price:2499,theme:"ruby",cover:"M4A4 | Howl",items:[["AK-47 | Bloodsport",5100,45],["M4A4 | Howl",125000,15],["AWP | Dragon Lore",25000,30],["★ Butterfly Knife | Crimson Web",54000,9.5],["★ Karambit | Sapphire",115000,0.5]]}
,{id:"sapphire",name:"САПФИРОВЫЙ",subtitle:"Синие драгоценности и ножи",price:4499,theme:"sapphire",cover:"★ Karambit | Sapphire",items:[["AK-47 | Case Hardened",18000,45],["AWP | Medusa",78000,30],["★ M9 Bayonet | Doppler",68000,19],["★ Karambit | Sapphire",115000,5.5],["★ Butterfly Knife | Doppler",85000,0.5]]}
,{id:"knife-rush",name:"НОЖЕВОЙ РАШ",subtitle:"Только ножи — от доступных до легенд",price:4999,theme:"knife",cover:"★ Butterfly Knife | Marble Fade",items:[["★ Gut Knife | Doppler",16000,42],["★ Bowie Knife | Doppler",17500,32],["★ Talon Knife | Fade",42000,18],["★ Butterfly Knife | Marble Fade",72000,7.5],["★ Karambit | Sapphire",115000,0.5]]}
,{id:"glove-boom",name:"ПЕРЧАТОЧНЫЙ БУМ",subtitle:"Перчатки с яркими расцветками",price:5499,theme:"gloves",cover:"★ Sport Gloves | Vice",items:[["★ Driver Gloves | Crimson Weave",14500,48],["★ Specialist Gloves | Fade",22000,32],["★ Sport Gloves | Vice",48000,15],["★ Sport Gloves | Vice",72000,4.5],["★ Karambit | Sapphire",115000,0.5]]}
,{id:"dragon-vault",name:"ДРАКОНЬЯ СОКРОВИЩНИЦА",subtitle:"Собрание самых желанных предметов",price:9999,theme:"dragon",cover:"AWP | Dragon Lore",items:[["AK-47 | Fire Serpent",9800,40],["AWP | Dragon Lore",25000,35],["AWP | Gungnir",95000,18],["AK-47 | Wild Lotus",110000,6.5],["M4A4 | Howl",125000,0.5]]}
,{id:"eco-round",name:"ЭКО-РАУНД",subtitle:"Недорогой кейс на каждый день",price:59,theme:"eco",cover:"AK-47 | Elite Build",items:[["Glock-18 | Candy Apple",45,52],["MP9 | Capillary",65,28],["AWP | Atheris",220,15],["AK-47 | Slate",360,4.5],["AK-47 | Neon Rider",980,0.5]]}
,{id:"starter-plus",name:"ПЕРВЫЙ ДРОП",subtitle:"Небольшая цена — приятные скины",price:99,theme:"starter",cover:"USP-S | Neo-Noir",items:[["P250 | Sand Dune",85,48],["USP-S | Ticket to Hell",120,30],["AWP | Fever Dream",340,17],["USP-S | Neo-Noir",880,4.5],["M4A1-S | Printstream",2350,0.5]]}
,{id:"midnight",name:"ПОЛУНОЧЬ",subtitle:"Ночная подборка редких расцветок",price:299,theme:"midnight",cover:"USP-S | Kill Confirmed",items:[["AWP | Mortis",330,45],["AK-47 | Phantom Disruptor",390,32],["USP-S | Kill Confirmed",3600,17],["★ Talon Knife | Doppler",36500,5.5],["★ Butterfly Knife | Fade",62000,0.5]]}
,{id:"gradient",name:"ГРАДИЕНТ",subtitle:"Переливы цвета и премиум-скины",price:799,theme:"gradient",cover:"AWP | Fade",items:[["Glock-18 | Vogue",180,45],["M4A1-S | Printstream",2350,32],["AWP | Fade",52000,17],["★ Stiletto Knife | Fade",31000,5.5],["★ Butterfly Knife | Fade",62000,0.5]]}
];
cases.forEach(c=>{if(!c.cover)c.cover=c.items[c.items.length-1][0];});
async function caseImageData(){
 let skinsIndex=new Map(),cratesIndex=new Map();
 try{skinsIndex=await getSkinImageIndex()}catch(error){console.warn("Case skin images unavailable:",error.message)}
 try{cratesIndex=await getCrateImageIndex()}catch(error){console.warn("Case cover images unavailable:",error.message)}
 return {skinsIndex,cratesIndex};
}
app.get("/api/cases",async(req,res)=>{
 const {skinsIndex,cratesIndex}=await caseImageData();
 res.json(cases.map(({id,name,subtitle,price,theme,items,cover})=>{
  const coverImage=resolveSkinImage(cover,skinsIndex)||cratesIndex.get(String(caseImageSource[theme]||"").toLowerCase())||"";
  return {id,name,subtitle,price,theme:theme||"classic",count:items.length,image:coverImage};
 }));
});
app.get("/api/cases/:id",async(req,res)=>{
 const c=cases.find(x=>x.id===req.params.id);if(!c)return res.status(404).json({error:"Кейс не найден"});
 const {skinsIndex,cratesIndex}=await caseImageData();
 const coverImage=resolveSkinImage(c.cover,skinsIndex)||cratesIndex.get(String(caseImageSource[c.theme]||"").toLowerCase())||"";
 res.json({id:c.id,name:c.name,subtitle:c.subtitle,price:c.price,theme:c.theme||"classic",count:c.items.length,image:coverImage,items:c.items.map(([name,value,chance])=>({name,value,chance,image:resolveSkinImage(name,skinsIndex)}))});
});
const skinCatalog=[
 ["Glock-18 | Candy Apple",45,65,"Армейское","pistols/glock-18-candy-apple.png"],
 ["MP9 | Capillary",65,95,"Армейское","smgs/mp9-capillary.png"],
 ["P250 | Sand Dune",85,120,"Промышленное","pistols/p250-sand-dune.png"],
 ["USP-S | Ticket to Hell",120,180,"Запрещённое","pistols/usp-s-ticket-to-hell.png"],
 ["AK-47 | Elite Build",190,290,"Запрещённое","rifles/ak-47-elite-build.png"],
 ["Desert Eagle | Bronze Deco",95,140,"Запрещённое","pistols/desert-eagle-bronze-deco.png"],
 ["AWP | Atheris",220,330,"Запрещённое","rifles/awp-atheris.png"],
 ["AK-47 | Slate",360,540,"Запрещённое","rifles/ak-47-slate.png"],
 ["M4A4 | Desolate Space",590,890,"Засекреченное","rifles/m4a4-desolate-space.png"],
 ["USP-S | Neo-Noir",880,1320,"Тайное","pistols/usp-s-neo-noir.png"],
 ["Glock-18 | Vogue",180,270,"Засекреченное","pistols/glock-18-vogue.png"],
 ["MP9 | Food Chain",290,435,"Тайное","smgs/mp9-food-chain.png"],
 ["AK-47 | Neon Rider",980,1470,"Тайное","rifles/ak-47-neon-rider.png"],
 ["AWP | Neo-Noir",1450,2175,"Тайное","rifles/awp-neo-noir.png"],
 ["M4A1-S | Printstream",2350,3525,"Тайное","rifles/m4a1-s-printstream.png"],
 ["AK-47 | Redline",720,1080,"Засекреченное","rifles/ak-47-redline.png"],
 ["AWP | Wildfire",1250,1875,"Тайное","rifles/awp-wildfire.png"],
 ["M4A4 | The Emperor",1750,2625,"Тайное","rifles/m4a4-the-emperor.png"],
 ["Desert Eagle | Blaze",4200,6300,"Запрещённое","pistols/desert-eagle-blaze.png"],
 ["AK-47 | Bloodsport",5100,7650,"Тайное","rifles/ak-47-bloodsport.png"],
 ["AWP | Asiimov",1850,2775,"Тайное","rifles/awp-asiimov.png"],
 ["AWP | Hyper Beast",2200,3300,"Тайное","rifles/awp-hyper-beast.png"],
 ["AWP | Dragon Lore",471500,471500,"Тайное","rifles/awp-dragon-lore.png"],
 ["★ Karambit | Doppler",38500,57750,"Нож","knives/karambit-doppler.png"],
 ["★ Butterfly Knife | Fade",62000,93000,"Нож","knives/butterfly-knife-fade.png"],
 ["★ Karambit | Fade",55000,82500,"Нож","knives/karambit-fade.png"],
 ["★ Huntsman Knife | Doppler",12500,18750,"Нож","knives/huntsman-knife-doppler.png"],
 ["★ Bayonet | Doppler",32000,48000,"Нож","knives/bayonet-doppler.png"],
 ["★ Navaja Knife | Fade",7500,11250,"Нож","knives/navaja-knife-fade.png"],
 ["★ Shadow Daggers | Doppler",9800,14700,"Нож","knives/shadow-daggers-doppler.png"],
 ["SSG 08 | Dragonfire",420,630,"Тайное","rifles/ssg-08-dragonfire.png"],
 ["AWP | Containment Breach",3900,5850,"Тайное","rifles/awp-containment-breach.png"],
 ["AK-47 | Fire Serpent",9800,14700,"Тайное","rifles/ak-47-fire-serpent.png"],
 ["★ M9 Bayonet | Crimson Web",41000,61500,"Нож","knives/m9-bayonet-crimson-web.png"],
 ["★ Karambit | Sapphire",115000,172500,"Нож","knives/karambit-sapphire.png"],

 ["M4A1-S | Decimator",650,975,"Засекреченное",""],
 ["AK-47 | Ice Coaled",520,780,"Засекреченное",""],
 ["AWP | Fever Dream",340,510,"Засекреченное",""],
 ["USP-S | Cortex",260,390,"Засекреченное",""],
 ["Desert Eagle | Printstream",2100,3150,"Тайное",""],
 ["Glock-18 | Water Elemental",720,1080,"Засекреченное",""],
 ["M4A4 | Magnesium",75,110,"Армейское",""],
 ["MP9 | Starlight Protector",1850,2775,"Тайное",""],
 ["AK-47 | The Empress",6900,10350,"Тайное",""],
 ["M4A1-S | Hyper Beast",1850,2775,"Тайное",""],
 ["AK-47 | Asiimov",1650,2475,"Тайное",""],
 ["FAMAS | Mecha Industries",520,780,"Засекреченное",""],
 ["P90 | Asiimov",850,1275,"Засекреченное",""],
 ["MAC-10 | Disco Tech",420,630,"Засекреченное",""],
 ["Five-SeveN | Angry Mob",980,1470,"Тайное",""],
 ["P250 | See Ya Later",920,1380,"Тайное",""],
 ["Galil AR | Chatterbox",1250,1875,"Тайное",""],
 ["SSG 08 | Blood in the Water",2350,3525,"Тайное",""],
 ["★ Bowie Knife | Doppler",17500,26250,"Нож",""],
 ["★ Talon Knife | Fade",42000,63000,"Нож",""],
 ["★ Flip Knife | Gamma Doppler",28000,42000,"Нож",""],
 ["★ Stiletto Knife | Doppler",24500,36750,"Нож",""],
 ["★ Ursus Knife | Fade",19000,28500,"Нож",""],
 ["★ Skeleton Knife | Slaughter",33000,49500,"Нож",""],
 ["AWP | Mortis",330,495,"Засекреченное",""],
 ["AK-47 | Phantom Disruptor",390,585,"Засекреченное",""],
 ["M4A4 | Neo-Noir",2250,3375,"Тайное",""],
 ["USP-S | Kill Confirmed",3600,5400,"Тайное",""],
 ["Desert Eagle | Kumicho Dragon",980,1470,"Засекреченное",""],
 ["AK-47 | Jaguar",1850,2775,"Тайное",""],
 ["★ Butterfly Knife | Doppler",85000,127500,"Нож",""],
 ["★ Sport Gloves | Vice",48000,72000,"Перчатки",""],
 ["★ Driver Gloves | Crimson Weave",14500,21750,"Перчатки",""],
 ["★ Specialist Gloves | Fade",22000,33000,"Перчатки",""],
 ["★ Talon Knife | Doppler",36500,54750,"Нож",""],
 ["★ Talon Knife | Marble Fade",39000,58500,"Нож",""],
 ["★ Butterfly Knife | Marble Fade",72000,108000,"Нож",""],
 ["★ M9 Bayonet | Doppler",68000,102000,"Нож",""],
 ["★ M9 Bayonet | Fade",74000,111000,"Нож",""],
 ["★ Karambit | Tiger Tooth",52000,78000,"Нож",""],
 ["★ Karambit | Marble Fade",69000,103500,"Нож",""],
 ["★ Butterfly Knife | Crimson Web",54000,81000,"Нож",""],
 ["★ Skeleton Knife | Fade",46000,69000,"Нож",""],
 ["★ Nomad Knife | Fade",26000,39000,"Нож",""],
 ["★ Classic Knife | Fade",29000,43500,"Нож",""],
 ["★ Stiletto Knife | Fade",31000,46500,"Нож",""],
 ["★ Ursus Knife | Doppler",23500,35250,"Нож",""],
 ["★ Bowie Knife | Doppler",17500,26250,"Нож",""],
 ["★ Falchion Knife | Doppler",21000,31500,"Нож",""],
 ["★ Gut Knife | Doppler",16000,24000,"Нож",""],
 ["★ Flip Knife | Gamma Doppler",28000,42000,"Нож",""]

 ,["AK-47 | Vulcan",22000,33000,"Тайное",""]
 ,["AK-47 | Case Hardened",18000,27000,"Тайное",""]
 ,["AK-47 | Wild Lotus",110000,165000,"Тайное",""]
 ,["AK-47 | Gold Arabesque",68000,102000,"Тайное",""]
 ,["AK-47 | X-Ray",42000,63000,"Тайное",""]
 ,["AWP | Gungnir",95000,142500,"Тайное",""]
 ,["AWP | Medusa",78000,117000,"Тайное",""]
 ,["AWP | Fade",52000,78000,"Тайное",""]
 ,["AWP | Lightning Strike",12500,18750,"Тайное",""]
 ,["AWP | Oni Taiji",6500,9750,"Тайное",""]
 ,["M4A4 | Howl",125000,187500,"Контрабанда",""]
 ,["M4A4 | Poseidon",32000,48000,"Тайное",""]
 ,["M4A1-S | Hot Rod",18000,27000,"Тайное",""]
 ,["M4A1-S | Golden Coil",4200,6300,"Тайное",""]
 ,["M4A1-S | Player Two",3800,5700,"Тайное",""]
 ,["Glock-18 | Fade",16000,24000,"Тайное",""]
 ,["P90 | Death by Kitty",4200,6300,"Тайное",""]
 ,["★ Karambit | Gamma Doppler",92000,138000,"Нож",""]
 ,["★ Butterfly Knife | Tiger Tooth",79000,118500,"Нож",""]
 ,["★ M9 Bayonet | Lore",88000,132000,"Нож",""]
].map(([name,value,steamRub,rarity,image])=>({name,value,steamRub:value,rarity,image:"https://images.konekocode.pl/images/"+image,marketWear:rarity==="Нож" && /(Doppler|Fade|Marble Fade|Tiger Tooth|Sapphire|Emerald)/i.test(name)?"Factory New":"Field-Tested",steamUrl:"https://steamcommunity.com/market/listings/730/"+encodeURIComponent(name+" (Field-Tested)")}));
 skinCatalog.push(...[
  ["★ Sport Gloves | Pandora's Box",140000,"Перчатки"],["★ Sport Gloves | Hedge Maze",125000,"Перчатки"],
  ["★ Specialist Gloves | Crimson Kimono",95000,"Перчатки"],["★ Driver Gloves | King Snake",45000,"Перчатки"],
  ["★ Butterfly Knife | Emerald",260000,"Нож"],["★ Karambit | Emerald",220000,"Нож"],
  ["★ M9 Bayonet | Sapphire",180000,"Нож"],["★ Talon Knife | Sapphire",90000,"Нож"],
  ["★ Butterfly Knife | Gamma Doppler",105000,"Нож"],["★ Karambit | Gamma Doppler",92000,"Нож"],
  ["★ M9 Bayonet | Lore",88000,"Нож"],["★ Butterfly Knife | Tiger Tooth",79000,"Нож"],
  ["★ Butterfly Knife | Slaughter",68000,"Нож"],["★ Karambit | Crimson Web",72000,"Нож"],
  ["★ Karambit | Autotronic",52000,"Нож"],["★ M9 Bayonet | Autotronic",48000,"Нож"],
  ["★ Skeleton Knife | Crimson Web",39000,"Нож"],["★ Nomad Knife | Crimson Web",28000,"Нож"],
  ["AWP | Gungnir",95000,"Тайное"],["AWP | Medusa",78000,"Тайное"],["AWP | Fade",52000,"Тайное"],
  ["AK-47 | Wild Lotus",110000,"Тайное"],["AK-47 | Gold Arabesque",68000,"Тайное"],["AK-47 | X-Ray",42000,"Тайное"],
  ["M4A4 | Poseidon",32000,"Тайное"],["M4A1-S | Hot Rod",18000,"Тайное"],["Glock-18 | Fade",16000,"Тайное"]
 ].filter(([name])=>!skinCatalog.some(s=>s.name===name)).map(([name,value,rarity])=>({name,value,steamRub:value,rarity,marketWear:"Field-Tested",image:"",steamUrl:"https://steamcommunity.com/market/search?appid=730&q="+encodeURIComponent(name)})));
 skinCatalog.push(...[
  ["AK-47 | Hydroponic",55000,"Тайное"],["AK-47 | Panthera onca",45000,"Тайное"],
  ["AWP | The Prince",65000,"Тайное"],["AWP | Desert Hydra",70000,"Тайное"],["AWP | Pink DDPAT",16000,"Тайное"],
  ["M4A4 | Eye of Horus",25000,"Тайное"],["M4A1-S | Welcome to the Jungle",50000,"Тайное"],["M4A1-S | Knight",30000,"Тайное"],
  ["Desert Eagle | Hand Cannon",15000,"Тайное"],["Desert Eagle | Golden Koi",9000,"Тайное"],
  ["★ Sport Gloves | Superconductor",85000,"Перчатки"],["★ Sport Gloves | Amphibious",48000,"Перчатки"],
  ["★ Specialist Gloves | Emerald Web",45000,"Перчатки"],["★ Specialist Gloves | Marble Fade",28000,"Перчатки"],
  ["★ Driver Gloves | Snow Leopard",30000,"Перчатки"],["★ Moto Gloves | Spearmint",80000,"Перчатки"],
  ["★ Moto Gloves | POW!",25000,"Перчатки"],["★ Hand Wraps | Cobalt Skulls",30000,"Перчатки"],
  ["★ Karambit | Blue Steel",42000,"Нож"],["★ Karambit | Case Hardened",80000,"Нож"],
  ["★ Butterfly Knife | Blue Steel",45000,"Нож"],["★ Butterfly Knife | Case Hardened",70000,"Нож"],
  ["★ M9 Bayonet | Black Laminate",35000,"Нож"],["★ M9 Bayonet | Blue Steel",40000,"Нож"],
  ["★ Talon Knife | Marble Fade",48000,"Нож"],["★ Skeleton Knife | Slaughter",38000,"Нож"]
 ].filter(([name])=>!skinCatalog.some(s=>s.name===name)).map(([name,value,rarity])=>({name,value,steamRub:value,rarity,marketWear:"Field-Tested",image:"",steamUrl:"https://steamcommunity.com/market/search?appid=730&q="+encodeURIComponent(name)})));
 skinCatalog.push(...[
  ["AK-47 | Inheritance",4200,"Тайное"],["AWP | Chromatic Aberration",950,"Тайное"],
  ["M4A4 | Temukau",1800,"Тайное"],["USP-S | Printstream",1250,"Тайное"],
  ["Desert Eagle | Printstream",2100,"Тайное"],["AK-47 | Head Shot",1150,"Засекреченное"],
  ["M4A1-S | Black Lotus",850,"Засекреченное"],["Glock-18 | Shinobu",720,"Засекреченное"],
  ["M4A1-S | Blue Phosphor",12500,"Тайное"],["AWP | Duality",380,"Засекреченное"]
 ].map(([name,value,rarity])=>({name,value,steamRub:value,rarity,marketWear:"Field-Tested",image:"",steamUrl:"https://steamcommunity.com/market/search?appid=730&q="+encodeURIComponent(name)})));
 cases.push({id:"new-drop",name:"НОВЫЙ ДРОП",subtitle:"Свежие скины CS2",price:599,theme:"gradient",cover:"AK-47 | Inheritance",items:[["AWP | Chromatic Aberration",950,38],["Glock-18 | Shinobu",720,28],["AK-47 | Head Shot",1150,20],["M4A4 | Temukau",1800,10],["AK-47 | Inheritance",4200,4]]});
 const dragonLoreFallback=skinCatalog.find(s=>s.name==="AWP | Dragon Lore");
 if(dragonLoreFallback){dragonLoreFallback.priceSource="Оценка рынка";dragonLoreFallback.priceUpdatedAt=Date.now()}
 skinCatalog.push(...[
  ["AK-47 | Case Hardened (Blue Gem #661)",2500000,"Тайное","AK-47 | Case Hardened"],
  ["AK-47 | Case Hardened (Blue Gem #151)",1400000,"Тайное","AK-47 | Case Hardened"],
  ["★ Karambit | Case Hardened (Blue Gem #387)",3200000,"Нож","★ Karambit | Case Hardened"],
  ["★ Butterfly Knife | Case Hardened (Blue Gem)",1800000,"Нож","★ Butterfly Knife | Case Hardened"],
  ["AWP | Dragon Lore (Souvenir Factory New)",1250000,"Тайное","AWP | Dragon Lore"],
  ["★ M9 Bayonet | Sapphire (Factory New)",1800000,"Нож","★ M9 Bayonet | Sapphire"],
  ["★ Butterfly Knife | Emerald (Factory New)",2000000,"Нож","★ Butterfly Knife | Emerald"],
  ["★ Sport Gloves | Pandora's Box (Factory New)",1500000,"Перчатки","★ Sport Gloves | Pandora's Box"],
  ["★ Karambit | Emerald (Factory New)",2200000,"Нож","★ Karambit | Emerald"],
  ["★ Butterfly Knife | Doppler Black Pearl",1350000,"Нож","★ Butterfly Knife | Doppler"]
 ].filter(([name])=>!skinCatalog.some(s=>s.name===name)).map(([name,value,rarity,imageBaseName])=>({name,value,steamRub:value,rarity,marketWear:"Factory New",image:"",imageBaseName,fixedPrice:true,priceSource:"Виртуальная коллекционная оценка",steamUrl:"https://steamcommunity.com/market/search?appid=730&q="+encodeURIComponent(name)})));

 skinCatalog.push(...[
  ["AWP | Dragon Lore (Factory New)",850000,"Тайное","AWP | Dragon Lore"],
  ["AWP | Gungnir (Factory New)",520000,"Тайное","AWP | Gungnir"],
  ["AWP | Medusa (Factory New)",390000,"Тайное","AWP | Medusa"],
  ["AK-47 | Wild Lotus (Factory New)",480000,"Тайное","AK-47 | Wild Lotus"],
  ["M4A4 | Howl (Factory New)",360000,"Контрабанда","M4A4 | Howl"],
  ["★ Sport Gloves | Vice (Factory New)",310000,"Перчатки","★ Sport Gloves | Vice"],
  ["★ Specialist Gloves | Crimson Kimono (Factory New)",470000,"Перчатки","★ Specialist Gloves | Crimson Kimono"],
  ["★ Karambit | Doppler Ruby (Factory New)",920000,"Нож","★ Karambit | Doppler"],
  ["★ M9 Bayonet | Doppler Ruby (Factory New)",610000,"Нож","★ M9 Bayonet | Doppler"],
  ["★ Butterfly Knife | Doppler Ruby (Factory New)",780000,"Нож","★ Butterfly Knife | Doppler"],
  ["★ Butterfly Knife | Fade (Factory New)",245000,"Нож","★ Butterfly Knife | Fade"],
  ["★ Karambit | Tiger Tooth (Factory New)",215000,"Нож","★ Karambit | Tiger Tooth"]
].filter(([name])=>!skinCatalog.some(s=>s.name===name)).map(([name,value,rarity,imageBaseName])=>({
  name,value,steamRub:value,rarity,marketWear:"Factory New",image:"",imageBaseName,
  fixedPrice:true,priceSource:"Виртуальная оценка CaseArena",steamUrl:"https://steamcommunity.com/market/search?appid=730&q="+encodeURIComponent(name)
})));

cases.push(
  {id:"aurora-vault",name:"AURORA VAULT",subtitle:"Премиальная охота за редчайшими скинами",price:8999,theme:"sapphire",cover:"AWP | Gungnir",items:[["AWP | Gungnir",95000,60],["AK-47 | Wild Lotus",110000,25],["★ Karambit | Sapphire",115000,10],["AWP | Dragon Lore",471500,4],["★ Karambit | Case Hardened (Blue Gem #387)",3200000,1]]},
  {id:"black-pearl",name:"ЧЁРНАЯ ЖЕМЧУЖИНА",subtitle:"Изумруды, сапфиры и коллекционные ножи",price:19999,theme:"blackpearl",cover:"★ Butterfly Knife | Emerald",items:[["★ M9 Bayonet | Sapphire",180000,55],["★ Butterfly Knife | Emerald",260000,25],["AWP | Dragon Lore (Souvenir Factory New)",1250000,12],["★ Butterfly Knife | Emerald (Factory New)",2000000,7],["★ Karambit | Case Hardened (Blue Gem #387)",3200000,1]]},
  {id:"god-tier",name:"GOD TIER",subtitle:"Премиальный кейс с ограниченным шансом на редкие предметы",price:49999,theme:"gold",cover:"★ Karambit | Sapphire",items:[["AK-47 | Fire Serpent",9800,55],["AWP | Dragon Lore",25000,25],["AWP | Gungnir",95000,12],["AK-47 | Wild Lotus",110000,6],["★ Karambit | Sapphire",115000,2]]}
 );
 const initialSkinPrices=new Map(skinCatalog.map(s=>[s.name,s.value]));
 for(const crate of cases)for(const item of crate.items)if(initialSkinPrices.has(item[0]))item[1]=initialSkinPrices.get(item[0]);
 const STEAM_PRICE_REFRESH_MS=60*60*1000;
 let steamPriceRefreshRunning=false,steamPriceLastUpdated=0;
 const parseSteamRubPrice=value=>{if(!value)return 0;const normalized=String(value).replace(/[^0-9,\.]/g,"").replace(/\.(?=.*\.)/g,"").replace(",",".");const n=Number(normalized);return Number.isFinite(n)&&n>0?n:0};
 async function refreshSteamPrices(){
  if(steamPriceRefreshRunning)return;
  steamPriceRefreshRunning=true;
  let updated=0;
  try{
   for(const skin of skinCatalog){
    if(skin.fixedPrice)continue;
    try{
     const marketHashName=skin.name+" ("+(skin.marketWear||"Field-Tested")+")";
     const url="https://steamcommunity.com/market/priceoverview/?"+new URLSearchParams({appid:"730",country:"RU",currency:"5",market_hash_name:marketHashName});
     const response=await fetch(url,{headers:{"Accept":"application/json","User-Agent":"Mozilla/5.0 CaseArena/1.0"},signal:AbortSignal.timeout(12000)});
     if(response.status===429){console.warn("Steam Market rate limit reached; remaining prices will refresh next cycle");break}
     if(response.ok){
      const data=await response.json();
      const price=parseSteamRubPrice(data.lowest_price)||parseSteamRubPrice(data.median_price);
      if(data.success&&price>0){const value=Math.max(1,Math.round(price));skin.value=value;skin.steamRub=value;skin.priceSource="Steam Market";skin.priceUpdatedAt=Date.now();updated++}
     }
    }catch(error){console.warn("Steam price unavailable for",skin.name,error.message)}
    await new Promise(resolve=>setTimeout(resolve,3300));
   }
   const priceByName=new Map(skinCatalog.map(s=>[s.name,s.value]));
   for(const crate of cases)for(const item of crate.items)if(priceByName.has(item[0]))item[1]=priceByName.get(item[0]);
   for(const skin of skinCatalog)if(skin.priceSource==="Steam Market"||skin.priceSource==="Оценка рынка")db.prepare("UPDATE inventory SET item_value=? WHERE item_name=?").run(skin.value,skin.name);
   await flushWrites();steamPriceLastUpdated=Date.now();
   console.log("Steam Market prices refreshed",{updated,total:skinCatalog.length,updatedAt:new Date(steamPriceLastUpdated).toISOString()});
  }finally{steamPriceRefreshRunning=false}
 }
let skinImageIndexPromise=null;
const caseImageSource={
 starter:"Kilowatt Case",dust:"Prisma 2 Case",neon:"Dreams & Nightmares Case",inferno:"Revolution Case",sniper:"Snakebite Case",royal:"Operation Bravo Case",knife:"Huntsman Weapon Case",elite:"Operation Breakout Weapon Case",viper:"Fracture Case",dragon:"Operation Phoenix Weapon Case",doppler:"Chroma Case",gloves:"Glove Case",blackpearl:"Spectrum Case",
 "ice-dragon":"Winter Offensive Weapon Case",cyberpunk:"CS20 Case","gold-hour":"Operation Wildfire Case",phoenix:"Operation Hydra Case",arctic:"Operation Vanguard Weapon Case",steel:"Spectrum 2 Case",blackout:"Danger Zone Case",glitch:"Shattered Web Case",emerald:"Gamma 2 Case",ruby:"Chroma 3 Case",sapphire:"Gamma Case","knife-rush":"Falchion Case","glove-boom":"Clutch Case","dragon-vault":"eSports 2013 Winter Case","eco-round":"eSports 2013 Case","starter-plus":"Recoil Case",midnight:"Horizon Case",gradient:"Prisma Case"
};;
let crateImageIndexPromise=null;
async function getCrateImageIndex(){
 if(!crateImageIndexPromise){
  crateImageIndexPromise=fetch("https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/crates.json",{signal:AbortSignal.timeout(25000)})
   .then(async response=>{if(!response.ok)throw new Error("CS2 crate catalogue unavailable");const rows=await response.json();return new Map(rows.filter(item=>item.type==="Case"&&item.name&&item.image).map(item=>[item.name.toLowerCase(),item.image]));})
   .catch(error=>{console.warn("CS2 crate images unavailable:",error.message);return new Map();});
 }
 return crateImageIndexPromise;
}
async function getSkinImageIndex(){
 if(!skinImageIndexPromise){
  skinImageIndexPromise=fetch("https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json",{signal:AbortSignal.timeout(12000)})
   .then(async response=>{if(!response.ok)throw new Error("Skin catalogue unavailable");const rows=await response.json();return new Map(rows.map(item=>[item.name,item.image]).filter(row=>row[0]&&row[1]));})
   .catch(error=>{console.warn("Skin image catalogue unavailable:",error.message);return new Map();});
 }
 return skinImageIndexPromise;
}
function resolveSkinImage(name,imageIndex){
 const exact=imageIndex.get(name);
 if(exact)return exact;
 const entry=skinCatalog.find(s=>s.name===name);
 if(entry?.imageBaseName&&imageIndex.has(entry.imageBaseName))return imageIndex.get(entry.imageBaseName);
 const base=String(name).replace(/ \(.*\)$/,"");
 return imageIndex.get(base)||"";
}
app.get("/api/skins",async(req,res)=>{
 let imageIndex=new Map();
 try{imageIndex=await getSkinImageIndex()}catch(error){console.warn("Skin images unavailable:",error.message)}
 res.json(skinCatalog.map(s=>({...s,image:resolveSkinImage(s.name,imageIndex)||(s.image&&!s.image.endsWith("/images/")?s.image:""),steamUrl:"https://steamcommunity.com/market/search?appid=730&q="+encodeURIComponent(s.name),priceUpdatedAt:s.priceUpdatedAt||null,priceSource:s.priceSource||"Ожидает котировку Steam"})));
});
app.post("/api/cases/:id/open",requireAuth,(req,res)=>{
  const u=current(req), c=cases.find(x=>x.id===req.params.id);
  if(!c) return res.status(404).json({error:"Кейс не найден"});
  const tx=db.transaction(()=>{
    const fresh=db.prepare("SELECT balance FROM users WHERE id=?").get(u.id);
    if(fresh.balance<c.price) throw new Error("Недостаточно средств");
    const eligibleItems=c.id==="god-tier"?c.items.filter(item=>Number(item[1])<140000):c.items; if(!eligibleItems.length)throw new Error("В кейсе пока нет доступных предметов"); const totalWeight=eligibleItems.reduce((sum,item)=>sum+(Number(item[2])||0),0); let roll=Math.random()*totalWeight; let selected=eligibleItems[eligibleItems.length-1]; for(const item of eligibleItems){roll-=Number(item[2])||0;if(roll<=0){selected=item;break;}} const [name,value]=selected;
    db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(c.price,u.id);
    db.prepare("INSERT INTO inventory(user_id,item_name,item_value) VALUES(?,?,?)").run(u.id,name,value);
    log(u.id,`Открыт кейс ${c.name}: ${name}`);
    return {name,value,balance:fresh.balance-c.price,caseName:c.name};
  });
  try { res.json(tx()); } catch(e) { res.status(400).json({error:e.message}); }
});
app.post("/api/inventory/:id/sell",requireAuth,(req,res)=>{
 const u=current(req),id=Number(req.params.id);
 if(!Number.isInteger(id))return res.status(400).json({error:"Некорректный предмет"});
 const item=db.prepare("SELECT * FROM inventory WHERE id=? AND user_id=?").get(id,u.id);
 if(!item)return res.status(404).json({error:"Предмет не найден"});
 const tx=db.transaction(()=>{
  db.prepare("DELETE FROM inventory WHERE id=? AND user_id=?").run(id,u.id);
  db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(item.item_value,u.id);
  log(u.id,"Продан "+item.item_name+" за "+item.item_value+" CR");
 });
 tx();
 res.json({ok:true,sold:item.item_value,user:userView(current(req))});
});
app.post("/api/upgrade",requireAuth,(req,res)=>{
  const u=current(req),itemId=Number(req.body.itemId),targetName=String(req.body.targetName||"").slice(0,120);
  if(!Number.isInteger(itemId)||!targetName)return res.status(400).json({error:"Выбери предмет и целевой скин"});
  const item=db.prepare("SELECT * FROM inventory WHERE id=? AND user_id=?").get(itemId,u.id);
  if(!item)return res.status(404).json({error:"Предмет не найден"});
  const targetSkin=skinCatalog.find(s=>s.name===targetName);
  if(!targetSkin)return res.status(400).json({error:"Такого скина нет в каталоге"});
  const target=Number(targetSkin.value);
  if(!Number.isFinite(target)||target<50||target>5000000||target<=item.item_value)return res.status(400).json({error:"Цель должна быть дороже предмета"});
  const chance=Math.min(75,item.item_value/target*75),success=Math.random()*100<chance;
  const tx=db.transaction(()=>{
    db.prepare("DELETE FROM inventory WHERE id=? AND user_id=?").run(item.id,u.id);
    if(success)db.prepare("INSERT INTO inventory(user_id,item_name,item_value) VALUES(?,?,?)").run(u.id,targetSkin.name,target);
    log(u.id,success?`Успешный апгрейд до ${targetSkin.name}`:`Неудачный апгрейд предмета ${item.item_name}`);
  });
  tx();
  res.json({success,chance:Math.round(chance),targetName:targetSkin.name,targetValue:target,message:success?"Апгрейд успешен":"Не получилось — предмет потерян",user:userView(current(req))});
});
app.post("/api/contracts",requireAuth,(req,res)=>{
  const u=current(req), ids=Array.isArray(req.body.itemIds)?req.body.itemIds.map(Number):[];
  if(ids.length<3||ids.length>5||ids.some(x=>!Number.isInteger(x))) return res.status(400).json({error:"Выберите от 3 до 5 предметов"});
  const rows=db.prepare(`SELECT * FROM inventory WHERE user_id=? AND id IN (${ids.map(()=>"?").join(",")})`).all(u.id,...ids);
  if(rows.length!==ids.length) return res.status(400).json({error:"Проверьте выбранные предметы"});
  const total=rows.reduce((s,x)=>s+x.item_value,0);
  const value=Math.floor(total*0.85);
  const tx=db.transaction(()=>{
    db.prepare(`DELETE FROM inventory WHERE user_id=? AND id IN (${ids.map(()=>"?").join(",")})`).run(u.id,...ids);
    db.prepare("INSERT INTO inventory(user_id,item_name,item_value) VALUES(?,?,?)").run(u.id,"Contract reward",value);
    log(u.id,`Создан контракт на ${value}`);
  });
  tx(); res.json({message:`Контракт создан. Новый предмет: ${value}`,user:userView(current(req))});
});
app.get("/api/users/:username",(req,res)=>{
 const username=String(req.params.username||"").trim().toLowerCase();
 const u=db.prepare("SELECT id,username,role,balance,created_at FROM users WHERE username=?").get(username);
 if(!u)return res.status(404).json({error:"Игрок не найден"});
 const items=db.prepare("SELECT item_name,item_value,created_at FROM inventory WHERE user_id=? ORDER BY id DESC").all(u.id);
 res.json({user:userView(u),inventory:items,inventoryValue:items.reduce((sum,x)=>sum+x.item_value,0),joined:u.created_at});
});

app.get("/api/leaderboard",(req,res)=>{
  res.json(db.prepare("SELECT username,role,balance,(SELECT COALESCE(SUM(item_value),0) FROM inventory WHERE user_id=users.id) AS inventory_value FROM users ORDER BY balance+inventory_value DESC LIMIT 20").all());
});
app.get("/api/battles",(req,res)=>res.json([
 {id:101,name:"Дуэль новичков",players:2,rounds:3,status:"Ожидает игроков",entry:100},
 {id:102,name:"Ночной баттл",players:3,rounds:5,status:"Идёт",entry:250},
 {id:103,name:"Большой замес",players:4,rounds:5,status:"Ожидает игроков",entry:500}
]));
app.post("/api/battles/:id/join",requireAuth,(req,res)=>{
 const entry=Number(req.body.entry);
 if(![100,250,500].includes(entry)) return res.status(400).json({error:"Недопустимый взнос"});
 const u=current(req);
 const tx=db.transaction(()=>{
   const b=db.prepare("SELECT balance FROM users WHERE id=?").get(u.id);
   if(b.balance<entry) throw new Error("Недостаточно средств");
   db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(entry,u.id);
   log(u.id,`Вступление в демо-баттл #${req.params.id}`);
 });
 try{tx();res.json({message:"Вы присоединились к демо-баттлу",user:userView(current(req))});}
 catch(e){res.status(400).json({error:e.message});}
});
app.get("/api/staff/users",requireAuth,requireStaff,(req,res)=>{
 const q=String(req.query.search||"").trim().slice(0,40).replace(/[%_]/g,"");
 const rows=db.prepare("SELECT id,username,role,banned FROM users WHERE username LIKE ? COLLATE NOCASE ORDER BY banned DESC,id DESC LIMIT 250").all("%"+q+"%");
 res.json({users:rows});
});
app.post("/api/staff/users/:id/action",requireAuth,requireStaff,(req,res)=>{
 const actor=current(req), id=Number(req.params.id), action=String(req.body.action||"");
 if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Некорректный игрок"});
 if(!["kick","ban","unban","set_role"].includes(action))return res.status(400).json({error:"Неизвестное действие"});
 const target=db.prepare("SELECT id,username,role,banned FROM users WHERE id=?").get(id);
 if(!target)return res.status(404).json({error:"Игрок не найден"});
 if(ownerShield(target))return res.status(403).json({error:"Аккаунт владельца защищён"});
 const actorRank=roleRank(actor.role), targetRank=roleRank(target.role);
 if(Number(target.id)===Number(actor.id))return res.status(403).json({error:"Нельзя управлять собственной ролью или аккаунтом"});
 if(actorRank<=targetRank)return res.status(403).json({error:"Можно управлять только сотрудниками ниже по иерархии"});
 if(action==="set_role"){
  const nextRole=String(req.body.role||"");
  if(actorRank<2)return res.status(403).json({error:"Назначать роли может администратор и выше"});
  if(!ROLE_ORDER.includes(nextRole)||nextRole==="owner"||roleRank(nextRole)>=actorRank)return res.status(403).json({error:"Нельзя назначить равную или более высокую роль"});
  if(nextRole===target.role)return res.status(400).json({error:"У игрока уже эта роль"});
  db.prepare("UPDATE users SET role=? WHERE id=?").run(nextRole,id);
  log(actor.id,"Роль игрока "+target.username+" изменена: "+ROLE_LABELS[target.role]+" → "+ROLE_LABELS[nextRole]);
  return res.json({ok:true,message:"Роль игрока изменена на "+ROLE_LABELS[nextRole]});
 }
 if(actorRank===1&&action!=="kick")return res.status(403).json({error:"Банить и разбанивать может администратор и выше"});
 if(actorRank===1&&target.role!=="user")return res.status(403).json({error:"Модератор может кикать только игроков"});
 if(action==="ban"&&target.banned)return res.status(400).json({error:"Игрок уже заблокирован"});
 if(action==="unban"&&!target.banned)return res.json({ok:true,message:"Игрок уже разблокирован"});
 if(action==="unban")db.prepare("UPDATE users SET banned=0,session_version=session_version+1 WHERE id=?").run(id);
 else db.prepare("UPDATE users SET "+(action==="ban"?"banned=1,":"")+"session_version=session_version+1 WHERE id=?").run(id);
 const messages={kick:"Игрок отключён",ban:"Игрок заблокирован",unban:"Блокировка снята"};
 log(actor.id,(action==="ban"?"Заблокирован ":action==="unban"?"Снят бан с ":"Кикнут ")+target.username);
 res.json({ok:true,message:messages[action]});
});

app.get("/api/owner/overview",requireAuth,requireOwner,(req,res)=>{
 const search=String(req.query.search||"").trim().slice(0,40).replace(/[%_]/g,"");
 const userFields="SELECT id,username,role,balance,banned,created_at,(SELECT COUNT(*) FROM inventory WHERE user_id=users.id) AS item_count,(SELECT COALESCE(SUM(item_value),0) FROM inventory WHERE user_id=users.id) AS inventory_value FROM users";
 const users=search
  ? db.prepare(userFields+" WHERE username LIKE ? COLLATE NOCASE ORDER BY banned DESC,id DESC LIMIT 250").all("%"+search+"%")
  : db.prepare(userFields+" ORDER BY banned DESC,id DESC LIMIT 250").all();
 const activity=db.prepare("SELECT activity.*,users.username FROM activity LEFT JOIN users ON users.id=activity.user_id ORDER BY activity.id DESC LIMIT 30").all();
 const totalUsers=db.prepare("SELECT COUNT(*) n FROM users").get().n;
 const totalItems=db.prepare("SELECT COUNT(*) n FROM inventory").get().n;
 const totalBalance=db.prepare("SELECT COALESCE(SUM(balance),0) n FROM users").get().n;
 const totalInventoryValue=db.prepare("SELECT COALESCE(SUM(item_value),0) n FROM inventory").get().n;
 res.json({users,activity,totalUsers,totalItems,totalBalance,totalInventoryValue,search});
});
app.post("/api/owner/users/:id/balance",requireAuth,requireOwner,(req,res)=>{
 const id=Number(req.params.id), amount=Number(req.body.amount), mode=req.body.mode==="add"?"add":"set";
 if(!Number.isInteger(id)||id<1||!Number.isInteger(amount)||amount<(mode==="add"?1:0)||amount>100000000) return res.status(400).json({error:"Проверь сумму"});
 const target=db.prepare("SELECT id,username,role,balance FROM users WHERE id=?").get(id);
 if(!target)return res.status(404).json({error:"Игрок не найден"});
 if(target.role==="owner"&&target.id!==current(req).id)return res.status(403).json({error:"Нельзя менять баланс другого владельца"});
 const nextBalance=mode==="add"?Number(target.balance)+amount:amount;
 if(nextBalance>100000000)return res.status(400).json({error:"Слишком большой баланс"});
 const tx=db.transaction(()=>{
  db.prepare("UPDATE users SET balance=? WHERE id=?").run(nextBalance,id);
  log(current(req).id,(mode==="add"?"Выдано ":"Установлен баланс ")+amount+" CR игроку "+target.username);
 });
 tx();
 res.json({ok:true,balance:nextBalance});
});
app.post("/api/owner/users/:id/role",requireAuth,requireOwner,(req,res)=>{
 const id=Number(req.params.id), role=String(req.body.role||"");
 if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Некорректный игрок"});
 if(!ROLE_ORDER.includes(role)||role==="owner") return res.status(400).json({error:"Недопустимая роль"});
 const target=db.prepare("SELECT id,username,role FROM users WHERE id=?").get(id);
 if(!target)return res.status(404).json({error:"Игрок не найден"});
 if(ownerShield(target))return res.status(403).json({error:"Владелец защищён от любых изменений роли"});
 const tx=db.transaction(()=>{
  db.prepare("UPDATE users SET role=? WHERE id=?").run(role,id);
  log(current(req).id,"Роль игрока "+target.username+" изменена на "+(ROLE_LABELS[role]||role));
 });
 tx();
 res.json({ok:true,role});
});
app.delete("/api/owner/users/:id",requireAuth,requireOwner,(req,res)=>{
 const id=Number(req.params.id);
 const target=db.prepare("SELECT id,username,role FROM users WHERE id=?").get(id);
 if(!target)return res.status(404).json({error:"Игрок не найден"});
 if(ownerShield(target))return res.status(403).json({error:"Нельзя удалить владельца"});
 const tx=db.transaction(()=>{
  db.prepare("DELETE FROM inventory WHERE user_id=?").run(id);
  db.prepare("DELETE FROM activity WHERE user_id=?").run(id);
  db.prepare("DELETE FROM users WHERE id=? AND role!='owner'").run(id);
 });
 tx();res.json({ok:true});
});

const port=Number(process.env.PORT)||3000;

async function startServer() {
 await initializePersistentDatabase();
 if (OWNER_USERNAME && OWNER_PASSWORD) {
   const existing = db.prepare("SELECT id FROM users WHERE username=?").get(OWNER_USERNAME);
   if (!existing) {
     const hash = bcrypt.hashSync(OWNER_PASSWORD, 12);
     db.prepare("INSERT INTO users(username,password_hash,role,balance) VALUES(?,?,?,?)")
       .run(OWNER_USERNAME, hash, "owner", 100000);
     console.log("OWNER account created:", OWNER_USERNAME);
   } else if (OWNER_RESET_PASSWORD) {
     const hash = bcrypt.hashSync(OWNER_PASSWORD, 12);
     db.prepare("UPDATE users SET role='owner', password_hash=? WHERE username=?").run(hash, OWNER_USERNAME);
     console.log("OWNER account password reset:", OWNER_USERNAME);
   } else {
     db.prepare("UPDATE users SET role='owner' WHERE username=?").run(OWNER_USERNAME);
   }
 }
 await flushWrites();
 app.listen(port,()=>{
  console.log("CaseArena running on port",port);
  setTimeout(()=>refreshSteamPrices().catch(error=>console.error("Steam price refresh failed:",error.message)),8000);
  const priceTimer=setInterval(()=>refreshSteamPrices().catch(error=>console.error("Steam price refresh failed:",error.message)),STEAM_PRICE_REFRESH_MS);
  priceTimer.unref?.();
 });
}
startServer().catch(error => {
 console.error("CaseArena startup failed:", error);
 process.exit(1);
});
