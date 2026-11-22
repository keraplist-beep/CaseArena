const $=s=>document.querySelector(s);
let me=null, inventory=[], selected=new Set();
const money=n=>`${Number(n).toLocaleString("ru-RU")} CR`;
async function api(url,opts={}){const r=await fetch(url,{...opts,headers:{"Content-Type":"application/json",...(opts.headers||{})}});const d=await r.json();if(!r.ok)throw Error(d.error||"Ошибка");return d}
function toast(t){const el=$("#toast");el.textContent=t;el.style.display="block";setTimeout(()=>el.style.display="none",2800)}
function openModal(title,html){$("#modal-title").textContent=title;$("#modal-body").innerHTML=html;$("#modal").classList.remove("hidden")}
function closeModal(){$("#modal").classList.add("hidden")}
window.closeModal=closeModal;
function authModal(){openModal("Вход в CaseArena",`<a class="btn secondary google-btn" href="/auth/google"><b>G</b> Продолжить с Google</a><p class="muted small">После первого входа через Google нужно будет придумать игровой ник.</p><div class="inline"><button class="btn secondary" onclick="authForm('login')">Войти по паролю</button><button class="btn secondary" onclick="authForm('register')">Регистрация</button></div><div id="auth-form"></div>`);authForm("login")}
function nicknameModal(){openModal("Выбери игровой ник",`<p class="muted">Google подключён. Придумай ник, который будут видеть другие игроки. Его можно выбрать только один раз.</p><form onsubmit="completeGoogleNick(event)"><input name="username" placeholder="Например, DragonKing" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" required><p class="muted small">3–20 символов: латиница, цифры и нижнее подчёркивание.</p><button class="btn primary">Продолжить в CaseArena</button></form>`)}
window.completeGoogleNick=async e=>{e.preventDefault();const username=new FormData(e.target).get("username");try{const d=await api("/api/google/complete-nickname",{method:"POST",body:JSON.stringify({username})});me=d.user;closeModal();history.replaceState({},"",location.pathname);await refresh();toast("Аккаунт создан. Добро пожаловать!")}catch(err){toast(err.message)}};
window.authForm=mode=>{$("#auth-form").innerHTML=`<form onsubmit="submitAuth(event,'${mode}')"><input name="username" placeholder="Никнейм" required minlength="3" maxlength="20"><input name="password" type="password" placeholder="Пароль (минимум 10 символов)" required minlength="10"><button class="btn primary">${mode==="login"?"Войти":"Создать аккаунт"}</button></form>`}
window.submitAuth=async(e,mode)=>{e.preventDefault();const f=new FormData(e.target);try{const d=await api("/api/"+(mode==="login"?"login":"register"),{method:"POST",body:JSON.stringify(Object.fromEntries(f))});me=d.user;closeModal();await refresh();toast("Добро пожаловать в CaseArena")}catch(err){toast(err.message)}}
async function refresh(){const d=await api("/api/me");me=d.user;inventory=d.inventory||[];renderAccount();renderProfile();if(me?.role==="owner")loadOwner();else $("#owner").classList.add("hidden")}
function renderAccount(){const a=$("#account");a.innerHTML=me?`<span>${me.username} ${me.role==="owner"?'<b class="owner-tag">OWNER</b>':""} · <b style="color:var(--gold)">${money(me.balance)}</b></span><button class="btn secondary" onclick="logout()">Выйти</button>`:`<button class="btn secondary" onclick="authModal()">Войти</button><button class="btn primary" onclick="authModal()">Регистрация</button>`}
window.authModal=authModal;
window.logout=async()=>{await api("/api/logout",{method:"POST"});me=null;inventory=[];await refresh();toast("Вы вышли из аккаунта")};
async function loadCases(){const cs=await api("/api/cases");$("#case-grid").innerHTML=cs.map((c,i)=>`<article class="case-card"><div class="case-icon">${["◇","✧","♢","♛"][i]}</div><h3>${c.name}</h3><div class="price">${money(c.price)}</div><button class="btn primary" onclick="openCase('${c.id}')">Открыть кейс</button></article>`).join("")}
window.openCase=async id=>{try{const d=await api(`/api/cases/${id}/open`,{method:"POST"});await refresh();toast(`Выпало: ${d.name} · ${money(d.value)}`)}catch(e){toast(e.message)}};
async function loadBattles(){const bs=await api("/api/battles");$("#battle-list").innerHTML=bs.map(b=>`<div class="battle"><div><strong>${b.name}</strong><p class="muted small">${b.players} игрока · ${b.rounds} раунда · ${b.status}</p></div><div><b style="color:var(--gold)">${money(b.entry)}</b> <button class="btn primary" onclick="joinBattle(${b.id},${b.entry})">Участвовать</button></div></div>`).join("")}
window.joinBattle=async(id,entry)=>{try{const d=await api(`/api/battles/${id}/join`,{method:"POST",body:JSON.stringify({entry})});await refresh();toast(d.message)}catch(e){toast(e.message)}};
function renderProfile(){const p=$("#profile-content");if(!me){p.innerHTML='<p class="muted">Войди в аккаунт, чтобы увидеть инвентарь.</p>';return}p.innerHTML=`<div class="inline" style="justify-content:space-between"><div><h3>${me.username} ${me.role==="owner"?'<span class="owner-tag">OWNER</span>':""}</h3><p class="muted small">Баланс: ${money(me.balance)} · Предметов: ${inventory.length}</p></div></div><div class="inventory">${inventory.length?inventory.map(x=>`<div class="item"><label><input type="checkbox" ${selected.has(x.id)?"checked":""} onchange="toggleItem(${x.id},this.checked)"> Выбрать</label><strong>${x.item_name}</strong><span style="color:var(--gold)">${money(x.item_value)}</span></div>`).join(""):'<p class="muted">Инвентарь пока пуст. Открой первый кейс!</p>'}</div>`}
window.toggleItem=(id,on)=>{on?selected.add(id):selected.delete(id)};
window.upgrade=async()=>{if(!me)return authModal();const item=inventory.find(x=>selected.has(x.id))||inventory[0];const target=Number($("#target-value").value);if(!item)return toast("Сначала открой кейс");try{const d=await api("/api/upgrade",{method:"POST",body:JSON.stringify({itemId:item.id,targetValue:target})});selected.clear();await refresh();toast(`${d.message} · шанс ${d.chance}%`)}catch(e){toast(e.message)}};
window.contract=async()=>{if(!me)return authModal();try{const d=await api("/api/contracts",{method:"POST",body:JSON.stringify({itemIds:[...selected]})});selected.clear();await refresh();toast(d.message)}catch(e){toast(e.message)}};
async function loadLeaders(){const rows=await api("/api/leaderboard");$("#leader-list").innerHTML=rows.length?rows.map((u,i)=>`<div class="rank"><b>#${i+1}</b><span>${u.username} ${u.role==="owner"?'<span class="owner-tag">OWNER</span>':""}</span><b style="color:var(--gold)">${money(u.balance+u.inventory_value)}</b></div>`).join(""):'Пока нет игроков'}
async function loadOwner(){try{const d=await api("/api/owner/overview");$("#owner").classList.remove("hidden");$("#owner-content").innerHTML=`<p>Всего аккаунтов: <b>${d.totalUsers}</b></p><h3>Пользователи</h3>${d.users.map(u=>`<div class="user-row"><span><b>${u.username}</b> ${u.role==="owner"?'<span class="owner-tag">OWNER</span>':""}<br><span class="muted">${u.role}</span></span><input id="bal-${u.id}" type="number" value="${u.balance}" ${u.role==="owner"?"disabled":""}><select id="role-${u.id}" ${u.role==="owner"?"disabled":""} style="background:#0c121c;color:white;border:1px solid #35445a;border-radius:7px"><option value="user" ${u.role==="user"?"selected":""}>user</option><option value="admin" ${u.role==="admin"?"selected":""}>admin</option></select><button class="btn secondary" onclick="saveUser(${u.id})" ${u.role==="owner"?"disabled":""}>Сохранить</button></div>`).join("")}<h3>Последние действия</h3>${d.activity.map(a=>`<p class="small muted">${a.username||"Система"} — ${a.message} <span>· ${a.created_at}</span></p>`).join("")}`}catch(e){$("#owner").classList.add("hidden")}}
window.saveUser=async id=>{try{await api(`/api/owner/users/${id}/balance`,{method:"POST",body:JSON.stringify({amount:Number($(`#bal-${id}`).value)})});await api(`/api/owner/users/${id}/role`,{method:"POST",body:JSON.stringify({role:$(`#role-${id}`).value})});await loadOwner();toast("Изменения сохранены")}catch(e){toast(e.message)}};
(async()=>{await loadCases();await loadBattles();await loadLeaders();await refresh();const params=new URLSearchParams(location.search);if(params.get("chooseNick")==="1"){nicknameModal()}else if(params.has("google")){toast("Не удалось выполнить вход через Google. Попробуйте ещё раз.");history.replaceState({},"",location.pathname)}})().catch(e=>toast(e.message));


// Enhanced profile, activity feed and live upgrade preview.
function renderProfile(){
 const p=$("#profile-content");
 if(!me){p.innerHTML='<p class="muted">Войди в аккаунт, чтобы увидеть инвентарь.</p>';$("#activity-list").innerHTML='<p class="muted small">История появится после входа.</p>';return}
 const initials=me.username.slice(0,2).toUpperCase();
 const total=inventory.reduce((s,x)=>s+Number(x.item_value),0);
 p.innerHTML='<div class="profile-head"><div class="avatar">'+initials+'</div><div><h3>'+me.username+' '+(me.role==="owner"?'<span class="owner-tag">OWNER</span>':'')+'</h3><div class="profile-stats"><span class="stat-chip">Баланс <b>'+money(me.balance)+'</b></span><span class="stat-chip">Предметы <b>'+inventory.length+'</b></span><span class="stat-chip">Инвентарь <b>'+money(total)+'</b></span></div></div></div><div class="inventory">'+(inventory.length?inventory.map(x=>'<div class="item"><label><input type="checkbox" '+(selected.has(x.id)?'checked':'')+' onchange="toggleItem('+x.id+',this.checked)"> Выбрать</label><strong>'+escapeText(x.item_name)+'</strong><span style="color:var(--gold)">'+money(x.item_value)+'</span></div>').join(''):'<p class="muted">Инвентарь пока пуст. Открой первый кейс!</p>')+'</div>';
 loadActivity();
}
function escapeText(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadActivity(){
 try{const rows=await api("/api/activity");$("#activity-list").innerHTML=rows.length?rows.map(a=>'<div class="activity-row"><span>'+escapeText(a.message)+'</span><time>'+new Date(a.created_at+"Z").toLocaleString("ru-RU",{dateStyle:"short",timeStyle:"short"})+'</time></div>').join(''):'<p class="muted small">Пока нет действий.</p>'}
 catch(e){$("#activity-list").innerHTML='<p class="muted small">История временно недоступна.</p>'}
}
window.updateUpgradePreview=()=>{
 const box=$("#upgrade-preview");if(!box)return;
 const item=inventory.find(x=>selected.has(x.id))||inventory[0],target=Number($("#target-value")?.value);
 if(!item||!target||target<=item.item_value){box.innerHTML='<span class="muted">Выбери предмет и введи цель дороже него</span>';return}
 const chance=Math.min(75,item.item_value/target*75),rounded=Math.round(chance);
 box.innerHTML='<div><b>'+escapeText(item.item_name)+'</b><div class="muted small">Стоимость '+money(item.item_value)+' → '+money(target)+'</div><div class="chance-track"><div class="chance-fill" style="width:'+rounded+'%"></div></div></div><div class="chance-number">'+rounded+'%</div>';
};
const originalToggleItem=window.toggleItem;
window.toggleItem=(id,on)=>{on?selected.add(id):selected.delete(id);updateUpgradePreview()};
const originalRefresh=refresh;
refresh=async()=>{await originalRefresh();updateUpgradePreview()};


// CaseArena gameplay interface: case roulette, skin upgrade picker and profile shortcut.
let upgradeTargetSkin = null;
let caseOpening = false;
const upgradeCatalog = [
 {name:"Glock-18 | Candy Apple",value:120,rarity:"Армейское",symbol:"◈"},
 {name:"USP-S | Cortex",value:260,rarity:"Запрещённое",symbol:"◉"},
 {name:"AK-47 | Slate",value:450,rarity:"Запрещённое",symbol:"◆"},
 {name:"AWP | Neo-Noir",value:900,rarity:"Тайное",symbol:"✦"},
 {name:"M4A1-S | Printstream",value:1800,rarity:"Тайное",symbol:"✧"},
 {name:"AK-47 | Neon Rider",value:3200,rarity:"Тайное",symbol:"◆"},
 {name:"★ Karambit | Doppler",value:8500,rarity:"Нож",symbol:"★"},
 {name:"★ Butterfly Knife | Fade",value:16000,rarity:"Нож",symbol:"✦"}
];
const caseArt=["▣","◈","✦","♛"];
function renderAccount(){
 const a=$("#account");
 a.innerHTML=me
 ? '<button class="profile-shortcut" onclick="goProfile()"><span class="mini-avatar">'+escapeText(me.username.slice(0,1).toUpperCase())+'</span><span class="account-name">'+escapeText(me.username)+(me.role==="owner"?' <b class="owner-tag">OWNER</b>':'')+'<small>'+money(me.balance)+'</small></span></button><button class="btn secondary" onclick="logout()">Выйти</button>'
 : '<button class="btn secondary" onclick="authModal()">Войти</button><button class="btn primary" onclick="authModal()">Регистрация</button>';
}
window.goProfile=()=>{if(!me)return authModal();location.hash="profile";$("#profile").scrollIntoView({behavior:"smooth"});};
async function loadCases(){
 const cs=await api("/api/cases");
 $("#case-grid").innerHTML=cs.map((c,i)=>'<article class="case-card"><div class="case-visual"><span class="case-glow"></span><div class="case-box-art">'+caseArt[i%caseArt.length]+'</div><span class="case-index">CASE 0'+(i+1)+'</span></div><div class="case-info"><h3>'+escapeText(c.name)+'</h3><p class="case-subtitle">'+(["Стартовый дроп","Неоновые сокровища","Охота за редкостью","Премиальная коллекция"][i%4])+'</p><div class="case-bottom"><div class="price">'+money(c.price)+'</div><button class="btn primary" onclick="openCase(\''+c.id+'\')">ОТКРЫТЬ</button></div></div></article>').join("");
}
window.openCase=async id=>{
 if(caseOpening)return;
 if(!me)return authModal();
 caseOpening=true;
 try{
  const d=await api('/api/cases/'+id+'/open',{method:'POST'});
  const decoys=["AK-47 | Slate","USP-S | Cortex","AWP | Neo-Noir","M4A1-S | Decimator","Glock-18 | Vogue","P250 | Asiimov","MP9 | Food Chain","FAMAS | Mecha Industries"];
  const items=Array.from({length:27},()=>decoys[Math.floor(Math.random()*decoys.length)]);
  items[23]=d.name;
  openModal("ОТКРЫТИЕ КЕЙСА",'<div class="roulette-wrap"><div class="roulette-pointer"></div><div id="roulette-window"><div id="roulette-track" class="roulette-track">'+items.map((n,i)=>'<div class="roulette-item '+(i===23?'roulette-winner':'')+'"><div class="roulette-item-art">'+(i===23?'★':'◆')+'</div><b>'+escapeText(n)+'</b><small>'+(i===23?money(d.value):"CS2 SKIN")+'</small></div>').join("")+'</div></div></div><p class="roulette-caption">Прокрутка предметов...</p>');
  const track=$("#roulette-track");
  requestAnimationFrame(()=>{track.style.transform='translateX(-'+(23*164-($("#roulette-window").clientWidth/2-82))+'px)'});
  await new Promise(resolve=>setTimeout(resolve,4300));
  $("#modal-body").innerHTML='<div class="win-result"><div class="win-star">★</div><p class="muted small">ТЕБЕ ВЫПАЛО</p><h3>'+escapeText(d.name)+'</h3><strong>'+money(d.value)+'</strong></div><button class="btn primary" style="width:100%;margin-top:18px" onclick="closeModal()">ЗАБРАТЬ ПРЕДМЕТ</button>';
  await refresh();
 }catch(e){toast(e.message)}finally{caseOpening=false}
};
function renderUpgrade(){
 const source=$("#upgrade-source"),targets=$("#upgrade-targets");
 if(!source||!targets)return;
 source.innerHTML=inventory.length?inventory.map(x=>'<button class="pick-card '+(selected.has(x.id)?'chosen':'')+'" onclick="chooseUpgradeSource('+x.id+')"><span class="pick-art">◆</span><b>'+escapeText(x.item_name)+'</b><small>'+money(x.item_value)+'</small></button>').join(""):'<p class="muted small">Инвентарь пуст — сначала открой кейс</p>';
 targets.innerHTML=upgradeCatalog.map((x,i)=>'<button class="pick-card target-card '+(upgradeTargetSkin===i?'chosen':'')+'" onclick="chooseUpgradeTarget('+i+')"><span class="pick-art">'+x.symbol+'</span><b>'+escapeText(x.name)+'</b><small>'+money(x.value)+'</small></button>').join("");
 updateUpgradePreview();
}
window.chooseUpgradeSource=id=>{selected.clear();selected.add(id);renderUpgrade()};
window.chooseUpgradeTarget=i=>{upgradeTargetSkin=i;renderUpgrade()};
window.updateUpgradePreview=()=>{
 const box=$("#upgrade-preview"),wheel=$("#upgrade-wheel-value");
 if(!box)return;
 const item=inventory.find(x=>selected.has(x.id))||inventory[0];
 const target=upgradeTargetSkin===null?null:upgradeCatalog[upgradeTargetSkin];
 if(!item||!target||target.value<=Number(item.item_value)){
  box.innerHTML='<span class="muted">'+(!item?'Открой кейс и выбери предмет':!target?'Выбери скин, который хочешь получить':'Цель должна быть дороже твоего предмета')+'</span>';
  if(wheel)wheel.textContent="—";
  return;
 }
 const chance=Math.min(75,Number(item.item_value)/target.value*75),n=Math.round(chance);
 if(wheel)wheel.textContent=n+"%";
 box.innerHTML='<div><b>'+escapeText(item.item_name)+'</b><div class="muted small">'+money(item.item_value)+' → '+escapeText(target.name)+' · '+money(target.value)+'</div><div class="chance-track"><div class="chance-fill" style="width:'+n+'%"></div></div></div><div class="chance-number">'+n+'%</div>';
};
window.upgrade=async()=>{
 if(!me)return authModal();
 const item=inventory.find(x=>selected.has(x.id))||inventory[0];
 const target=upgradeTargetSkin===null?null:upgradeCatalog[upgradeTargetSkin];
 if(!item)return toast("Сначала открой кейс");
 if(!target)return toast("Выбери целевой скин");
 if(target.value<=item.item_value)return toast("Целевой скин должен быть дороже");
 try{
  const d=await api("/api/upgrade",{method:"POST",body:JSON.stringify({itemId:item.id,targetValue:target.value,targetName:target.name})});
  selected.clear();
  openModal(d.success?"АПГРЕЙД УСПЕШЕН":"НЕ ПОВЕЗЛО",'<div class="win-result"><div class="win-star">'+(d.success?'✦':'×')+'</div><h3>'+(d.success?escapeText(target.name):'Предмет не улучшен')+'</h3><strong>'+d.chance+'% шанс</strong><p class="muted small">'+escapeText(d.message)+'</p></div><button class="btn primary" style="width:100%;margin-top:18px" onclick="closeModal()">ПОНЯТНО</button>');
  await refresh();
 }catch(e){toast(e.message)}
};
const baseRefresh=refresh;
refresh=async()=>{await baseRefresh();renderUpgrade()};
const baseProfile=renderProfile;
renderProfile=function(){
 baseProfile();
 if(me){
  const p=$("#profile-content");
  const btn=document.createElement("button");btn.className="btn secondary profile-edit-shortcut";btn.textContent="ПРОФИЛЬ И ИНВЕНТАРЬ";
  btn.onclick=()=>$("#profile").scrollIntoView({behavior:"smooth"});
  const head=p.querySelector(".profile-head");if(head)head.appendChild(btn);
 }
};
loadCases().catch(e=>toast(e.message));
