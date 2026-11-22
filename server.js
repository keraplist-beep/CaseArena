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
 google_sub TEXT
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
 const [users, inventory, activity] = await Promise.all([
   pool.query("SELECT * FROM users ORDER BY id"),
   pool.query("SELECT * FROM inventory ORDER BY id"),
   pool.query("SELECT * FROM activity ORDER BY id")
 ]);
 const remoteHasData = users.rowCount + inventory.rowCount + activity.rowCount > 0;
 if (remoteHasData) {
   localDb.exec("DELETE FROM inventory; DELETE FROM activity; DELETE FROM users;");
   for (const u of users.rows) localDb.prepare(
     "INSERT INTO users(id,username,password_hash,role,balance,created_at,google_sub) VALUES(?,?,?,?,?,?,?)"
   ).run(u.id,u.username,u.password_hash,u.role,u.balance,sqlTimestamp(u.created_at),u.google_sub);
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
     "INSERT INTO users(id,username,password_hash,role,balance,created_at,google_sub) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING",
     [u.id,u.username,u.password_hash,u.role,u.balance,u.created_at,u.google_sub]
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
const OWNER_USERNAME = (process.env.OWNER_USERNAME || "").trim().toLowerCase();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "";
const OWNER_RESET_PASSWORD = process.env.OWNER_RESET_PASSWORD === "true";
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({limit:"30kb"}));
app.use((req,res,next) => {
 const originalJson = res.json.bind(res);
 res.json = (payload) => {
   writeQueue.then(() => {
     if (writeError) {
       res.status(503);
       return originalJson({error:"Хранилище временно недоступно. Попробуйте ещё раз."});
     }
     return originalJson(payload);
   }).catch(error => {
     console.error("Response persistence check failed:", error.message);
     res.status(503);
     originalJson({error:"Хранилище временно недоступно."});
   });
   return res;
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
  return db.prepare("SELECT id,username,role,balance FROM users WHERE id=?").get(req.session.userId) || null;
}
function requireAuth(req,res,next) {
  if (!current(req)) return res.status(401).json({error:"Сначала войдите в аккаунт"});
  next();
}
function requireOwner(req,res,next) {
  const u=current(req);
  if (!u || u.role !== "owner") return res.status(403).json({error:"Только OWNER может выполнить это действие"});
  next();
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
    const info = db.prepare("INSERT INTO users(username,password_hash,google_sub,balance) VALUES(?,?,?,?)")
      .run(username, placeholderHash, pending.googleSub, 1000);
    req.session = req.session || {};
    req.session = req.session || {};
 req.session.userId = info.lastInsertRowid;
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
    const info=db.prepare("INSERT INTO users(username,password_hash) VALUES(?,?)").run(username,hash);
 req.session.userId = info.lastInsertRowid;
log(info.lastInsertRowid, "Создан аккаунт");

res.json({user:userView(current(req))});
  } catch(e) { res.status(409).json({error:"Такой ник уже занят"}); }
});
app.post("/api/login",authLimiter,async(req,res)=>{
  const username=String(req.body.username||"").trim().toLowerCase();
  const password=String(req.body.password||"");
  const u=db.prepare("SELECT * FROM users WHERE username=?").get(username);
  if (!u || !(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({error:"Неверный ник или пароль"});
  req.session = req.session || {};
  req.session.userId = u.id;

res.json({user:userView(u)});
});
app.post("/api/logout",(req,res)=>{req.session=null;res.json({ok:true});});

const cases=[
 {id:"starter",name:"РАЗМИНКА",subtitle:"Начни собирать инвентарь",price:79,items:[["Glock-18 | Candy Apple",45],["MP9 | Capillary",65],["P250 | Sand Dune",85],["USP-S | Ticket to Hell",120],["AK-47 | Elite Build",190]]},
 {id:"dust",name:"DUST II",subtitle:"Классика легендарной карты",price:179,items:[["Desert Eagle | Bronze Deco",95],["AWP | Atheris",220],["AK-47 | Slate",360],["M4A4 | Desolate Space",590],["USP-S | Neo-Noir",880]]},
 {id:"neon",name:"НЕОНОВЫЙ",subtitle:"Яркие цвета и контраст",price:349,items:[["Glock-18 | Vogue",180],["MP9 | Food Chain",290],["AK-47 | Neon Rider",980],["AWP | Neo-Noir",1450],["M4A1-S | Printstream",2350]]},
 {id:"inferno",name:"INFERNO",subtitle:"Огненная коллекция",price:599,items:[["AK-47 | Redline",720],["AWP | Wildfire",1250],["M4A4 | The Emperor",1750],["Desert Eagle | Blaze",4200],["AK-47 | Bloodsport",5100]]},
 {id:"sniper",name:"СНАЙПЕРСКИЙ",subtitle:"Только точные попадания",price:899,items:[["SSG 08 | Dragonfire",420],["AWP | Asiimov",1850],["AWP | Hyper Beast",2200],["AWP | Containment Breach",3900],["AWP | Dragon Lore",25000]]},
 {id:"royal",name:"КОРОЛЕВСКИЙ",subtitle:"Редкие и дорогие предметы",price:1499,items:[["M4A1-S | Printstream",2350],["AK-47 | Fire Serpent",9800],["★ Huntsman Knife | Doppler",12500],["★ Karambit | Doppler",38500],["★ Butterfly Knife | Fade",62000]]},
 {id:"knife",name:"ОХОТА ЗА НОЖОМ",subtitle:"Кейс для любителей ножей",price:2499,items:[["★ Navaja Knife | Fade",7500],["★ Shadow Daggers | Doppler",9800],["★ Huntsman Knife | Doppler",12500],["★ Karambit | Fade",55000],["★ Butterfly Knife | Fade",62000]]},
 {id:"elite",name:"ЭЛИТА",subtitle:"Максимальный риск и награда",price:4999,items:[["★ Bayonet | Doppler",32000],["★ M9 Bayonet | Crimson Web",41000],["★ Karambit | Doppler",38500],["★ Butterfly Knife | Fade",62000],["★ Karambit | Sapphire",115000]]}
];
app.get("/api/cases",(req,res)=>res.json(cases.map(({id,name,subtitle,price})=>({id,name,subtitle,price}))));
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
 ["AWP | Dragon Lore",25000,37500,"Тайное","rifles/awp-dragon-lore.png"],
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
 ["★ Karambit | Sapphire",115000,172500,"Нож","knives/karambit-sapphire.png"]

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
 ["AK-47 | Jaguar",1850,2775,"Тайное",""]
].map(([name,value,steamRub,rarity,image])=>({name,value,steamRub,rarity,image:"https://images.konekocode.pl/images/"+image,steamUrl:"https://steamcommunity.com/market/listings/730/"+encodeURIComponent(name+" (Field-Tested)")}));
let skinImageIndexPromise=null;
async function getSkinImageIndex(){
 if(!skinImageIndexPromise){
  skinImageIndexPromise=fetch("https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json",{signal:AbortSignal.timeout(12000)})
   .then(async response=>{if(!response.ok)throw new Error("Skin catalogue unavailable");const rows=await response.json();return new Map(rows.map(item=>[item.name,item.image]).filter(row=>row[0]&&row[1]));})
   .catch(error=>{console.warn("Skin image catalogue unavailable:",error.message);return new Map();});
 }
 return skinImageIndexPromise;
}
app.get("/api/skins",async(req,res)=>{
 const imageIndex=await getSkinImageIndex();
 res.json(skinCatalog.map(s=>({...s,image:imageIndex.get(s.name)||s.image,steamUrl:"https://steamcommunity.com/market/search?appid=730&q="+encodeURIComponent(s.name)})));
});
app.post("/api/cases/:id/open",requireAuth,(req,res)=>{
  const u=current(req), c=cases.find(x=>x.id===req.params.id);
  if(!c) return res.status(404).json({error:"Кейс не найден"});
  const tx=db.transaction(()=>{
    const fresh=db.prepare("SELECT balance FROM users WHERE id=?").get(u.id);
    if(fresh.balance<c.price) throw new Error("Недостаточно средств");
    const [name,value]=c.items[Math.floor(Math.random()*c.items.length)];
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
  const u=current(req), itemId=Number(req.body.itemId), target=Number(req.body.targetValue);
  if(!Number.isInteger(itemId)||!Number.isInteger(target)||target<50||target>1000000) return res.status(400).json({error:"Некорректные параметры"});
  const item=db.prepare("SELECT * FROM inventory WHERE id=? AND user_id=?").get(itemId,u.id);
  if(!item) return res.status(404).json({error:"Предмет не найден"});
  if(target<=item.item_value) return res.status(400).json({error:"Цель должна быть дороже предмета"});
  const chance=Math.min(75,item.item_value/target*75);
  if(Math.random()*100<chance) {
    db.prepare("DELETE FROM inventory WHERE id=?").run(item.id);
    const targetName=String(req.body.targetName||`Upgrade item (${target})`).slice(0,100);
    db.prepare("INSERT INTO inventory(user_id,item_name,item_value) VALUES(?,?,?)").run(u.id,targetName,target);
    log(u.id,`Успешный апгрейд до ${target}`);
    return res.json({success:true,chance:Math.round(chance),message:"Апгрейд успешен",user:userView(current(req))});
  }
  db.prepare("DELETE FROM inventory WHERE id=?").run(item.id);
  log(u.id,`Неудачный апгрейд предмета ${item.item_name}`);
  res.json({success:false,chance:Math.round(chance),message:"Не получилось — предмет потерян",user:userView(current(req))});
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
app.get("/api/owner/overview",requireAuth,requireOwner,(req,res)=>{
 const users=db.prepare("SELECT id,username,role,balance,created_at,(SELECT COUNT(*) FROM inventory WHERE user_id=users.id) AS item_count,(SELECT COALESCE(SUM(item_value),0) FROM inventory WHERE user_id=users.id) AS inventory_value FROM users ORDER BY id DESC LIMIT 100").all();
 const activity=db.prepare("SELECT activity.*,users.username FROM activity LEFT JOIN users ON users.id=activity.user_id ORDER BY activity.id DESC LIMIT 30").all();
 const totalUsers=db.prepare("SELECT COUNT(*) n FROM users").get().n;
 const totalItems=db.prepare("SELECT COUNT(*) n FROM inventory").get().n;
 const totalBalance=db.prepare("SELECT COALESCE(SUM(balance),0) n FROM users").get().n;
 res.json({users,activity,totalUsers,totalItems,totalBalance});
});
app.post("/api/owner/users/:id/balance",requireAuth,requireOwner,(req,res)=>{
 const amount=Number(req.body.amount);
 if(!Number.isInteger(amount)||amount<0||amount>100000000) return res.status(400).json({error:"Некорректный баланс"});
 db.prepare("UPDATE users SET balance=? WHERE id=?").run(amount,Number(req.params.id));
 res.json({ok:true});
});
app.post("/api/owner/users/:id/role",requireAuth,requireOwner,(req,res)=>{
 const role=req.body.role;
 if(!["user","admin"].includes(role)) return res.status(400).json({error:"Можно назначить только user или admin"});
 db.prepare("UPDATE users SET role=? WHERE id=? AND role!='owner'").run(role,Number(req.params.id));
 res.json({ok:true});
});
app.delete("/api/owner/users/:id",requireAuth,requireOwner,(req,res)=>{
 const id=Number(req.params.id);
 const target=db.prepare("SELECT id,username,role FROM users WHERE id=?").get(id);
 if(!target)return res.status(404).json({error:"Игрок не найден"});
 if(target.role==="owner")return res.status(403).json({error:"Нельзя удалить владельца"});
 const tx=db.transaction(()=>{
  db.prepare("DELETE FROM inventory WHERE user_id=?").run(id);
  db.prepare("DELETE FROM activity WHERE user_id=?").run(id);
  db.prepare("DELETE FROM users WHERE id=? AND role!='owner'").run(id);
 });
 tx();res.json({ok:true});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
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
 app.listen(port,()=>console.log("CaseArena running on port",port));
}
startServer().catch(error => {
 console.error("CaseArena startup failed:", error);
 process.exit(1);
});
