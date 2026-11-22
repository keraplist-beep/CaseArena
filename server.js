require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const app = express();
const db = new Database("casearena.db");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user',
 balance INTEGER NOT NULL DEFAULT 1000,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
// Backward-compatible migration for Google sign-in.
const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColumns.includes("google_sub")) db.exec("ALTER TABLE users ADD COLUMN google_sub TEXT");
const OWNER_USERNAME = (process.env.OWNER_USERNAME || "").trim().toLowerCase();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "";
if (OWNER_USERNAME && OWNER_PASSWORD) {
  const existing = db.prepare("SELECT id FROM users WHERE username=?").get(OWNER_USERNAME);
  if (!existing) {
    const hash = bcrypt.hashSync(OWNER_PASSWORD, 12);
    db.prepare("INSERT INTO users(username,password_hash,role,balance) VALUES(?,?,?,?)")
      .run(OWNER_USERNAME, hash, "owner", 100000);
    console.log("OWNER account created:", OWNER_USERNAME);
  } else {
    db.prepare("UPDATE users SET role='owner' WHERE username=?").run(OWNER_USERNAME);
  }
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({limit:"30kb"}));
app.use(session({
  store: new SQLiteStore({ db: "sessions.db", dir: "." }),
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000*60*60*24*7 }
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
  if (!req.session.userId) return null;
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
      req.session.userId = result.user.id;
      delete req.session.pendingGoogle;
      return req.session.save(() => res.redirect("/"));
    }
    req.session.pendingGoogle = { googleSub: result.googleSub, email: result.email };
    return req.session.save(() => res.redirect("/?chooseNick=1"));
  })(req,res,next);
});
app.get("/api/google/status", (req,res) => res.json({ configured: googleConfigured, pending: Boolean(req.session.pendingGoogle) }));
app.post("/api/google/complete-nickname", authLimiter, (req,res) => {
  const pending = req.session.pendingGoogle;
  if (!pending) return res.status(400).json({error:"Сначала войдите через Google"});
  const username = String(req.body.username || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({error:"Ник: 3–20 символов, латиница, цифры и _"});
  if (username === OWNER_USERNAME) return res.status(409).json({error:"Этот ник зарезервирован"});
  try {
    const placeholderHash = bcrypt.hashSync(require("crypto").randomBytes(48).toString("hex"), 12);
    const info = db.prepare("INSERT INTO users(username,password_hash,google_sub,balance) VALUES(?,?,?,?)")
      .run(username, placeholderHash, pending.googleSub, 1000);
    req.session.userId = info.lastInsertRowid;
    delete req.session.pendingGoogle;
    log(info.lastInsertRowid, "Аккаунт создан через Google");
    req.session.save(() => res.json({user:userView(current(req))}));
  } catch(e) { res.status(409).json({error:"Этот ник уже занят"}); }
});

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
    req.session.userId=info.lastInsertRowid;
    log(info.lastInsertRowid,"Создан аккаунт");
    res.json({user:userView(current(req))});
  } catch(e) { res.status(409).json({error:"Такой ник уже занят"}); }
});
app.post("/api/login",authLimiter,async(req,res)=>{
  const username=String(req.body.username||"").trim().toLowerCase();
  const password=String(req.body.password||"");
  const u=db.prepare("SELECT * FROM users WHERE username=?").get(username);
  if (!u || !(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({error:"Неверный ник или пароль"});
  req.session.userId=u.id;
  res.json({user:userView(u)});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

const cases=[
  {id:"starter",name:"STARTER",price:50,items:[["Glock-18 | Candy",35],["MP9 | Slide",65],["P250 | Steel",90]]},
  {id:"neon",name:"NEON",price:180,items:[["USP-S | Neon",100],["AK-47 | Neon Rider",260],["AWP | Electric",420]]},
  {id:"dragon",name:"DRAGON",price:500,items:[["M4A4 | Dragon",280],["AWP | Red Dragon",700],["AK-47 | Fireborn",1200]]},
  {id:"royal",name:"ROYAL",price:1200,items:[["★ Knife | Royal",800],["★ Gloves | Crown",1600],["★ Karambit | Gold",3500]]}
];
app.get("/api/cases",(req,res)=>res.json(cases.map(({id,name,price})=>({id,name,price}))));
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
    return {name,value,balance:fresh.balance-c.price};
  });
  try { res.json(tx()); } catch(e) { res.status(400).json({error:e.message}); }
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
    db.prepare("INSERT INTO inventory(user_id,item_name,item_value) VALUES(?,?,?)").run(u.id,`Upgrade item (${target})`,target);
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
 const users=db.prepare("SELECT id,username,role,balance,created_at FROM users ORDER BY id DESC LIMIT 100").all();
 const activity=db.prepare("SELECT activity.*,users.username FROM activity LEFT JOIN users ON users.id=activity.user_id ORDER BY activity.id DESC LIMIT 30").all();
 res.json({users,activity,totalUsers:db.prepare("SELECT COUNT(*) n FROM users").get().n});
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
 db.prepare("DELETE FROM inventory WHERE user_id=?").run(Number(req.params.id));
 db.prepare("DELETE FROM users WHERE id=? AND role!='owner'").run(Number(req.params.id));
 res.json({ok:true});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
const port=Number(process.env.PORT)||3000;
app.listen(port,()=>console.log(`CaseArena running at http://localhost:${port}`));
