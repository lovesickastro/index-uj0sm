function ic(n){return '<svg class="ic" aria-hidden="true"><use href="#i-'+n+'"/></svg>'}
(function(){
var $=function(s){return document.querySelector(s)},$$=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))};
var DEF={accent:"#5ee0ff",theme:"auto",fog:true,glow:true,cursive:false,perf:false,engine:"https://duckduckgo.com/?q="};
var S=Object.assign({},DEF);
try{var raw=localStorage.getItem("oxy-settings");if(raw)S=Object.assign(S,JSON.parse(raw))}catch(e){}
function save(){try{localStorage.setItem("oxy-settings",JSON.stringify(S))}catch(e){}}

function apply(){
  var r=document.documentElement;
  r.style.setProperty("--accent",S.accent);
  if(S.theme==="auto")r.removeAttribute("data-theme");else r.setAttribute("data-theme",S.theme);
  document.body.classList.toggle("cursive",S.cursive);
  document.body.classList.toggle("perf",S.perf);
  $("#fog").style.display=(S.fog&&!S.perf)?"block":"none";
  $("#glow").style.display=(S.glow&&!S.perf)?"block":"none";
  $("#accent").value=S.accent;$("#theme").value=S.theme;$("#fogOn").checked=S.fog;
  $("#glowOn").checked=S.glow;$("#cursive").checked=S.cursive;$("#perf").checked=S.perf;$("#engine").value=S.engine;
}
$("#accent").oninput=function(e){S.accent=e.target.value;save();apply()};
$("#theme").onchange=function(e){S.theme=e.target.value;save();apply()};
$("#engine").onchange=function(e){S.engine=e.target.value;save()};
[["fogOn","fog"],["glowOn","glow"],["cursive","cursive"],["perf","perf"]].forEach(function(p){
  $("#"+p[0]).onchange=function(e){S[p[1]]=e.target.checked;save();apply()}});
$("#reset").onclick=function(){S=Object.assign({},DEF);save();apply()};

var h=new Date().getHours();
$("#greet").textContent=h<5?"up late?":h<12?"good morning":h<18?"good afternoon":"good evening";

/* navigation */
function show(v){
  $$(".view").forEach(function(x){x.classList.toggle("on",x.id===v)});
  $$("nav button").forEach(function(b){b.classList.toggle("on",b.dataset.v===v)});
  if(v!=="games")stopGame();
  if(v==="chat")chatOnShow();
  if(v==="call")callOnShow();
  if(v==="vm")vmEnter();else vmLeave();
}
$$("nav button").forEach(function(b){b.onclick=function(){show(b.dataset.v)}});
var tiles=[["gamepad-2","games","Snake, memory and tic-tac-toe","games"],["volume-2","soundboard","31 meme sound effects","sounds"],["piano","piano","Play notes with your keyboard","music"],["sparkles","ai","Ask Rel AI for help with anything","ai"],["message-circle","chat","Talk to everyone on the server","chat"],["phone","calls","Voice and video calls with friends","call"],["monitor","virtual machine","Windows XP in your browser","vm"],["settings","settings","Colors, fog, cursor and more","settings"]];
$("#tiles").innerHTML=tiles.map(function(t){return '<button class="card" data-v="'+t[3]+'"><div class="e">'+ic(t[0])+'</div><b>'+t[1]+'</b><small>'+t[2]+'</small></button>'}).join("");
$$("#tiles .card").forEach(function(c){c.onclick=function(){show(c.dataset.v)}});
function search(){var q=$("#q").value.trim();if(q)openWeb(q)}
$("#go").onclick=search;$("#q").onkeydown=function(e){if(e.key==="Enter")search()};

/* meme soundboard */
var soundFiles=[
"BOOMBAMBOP.mp3","BRUH.mp3","DING.mp3","FBI OPEN UP.mp3","HA!GOTEE!HA!.mp3","Hello There.mp3","Hi How Are Ya.mp3","HUH.mp3","INCEPTION.mp3","MEANWHILE.mp3","Metal Boom.mp3","MINECRAFT OOF.mp3","MY LEG.mp3","NO GOD PLEASE NO.mp3","NOPE.mp3","OH NO NO NO.mp3","OH!!!!!!!.mp3","RIMSHOT.mp3","Sadness-1.mp3","Sadness-2.mp3","Sadness-3.mp3","SHREK-SWAMP.mp3","TACTICAL NUKE.mp3","TBC.mp3","The Screaming Sheep.mp3","Titanic-Paroday.mp3","Wait a minute....mp3","WINDOWS-ERROR.mp3","WINDOWS-STARTUP.mp3","WOW.mp3","YEET.mp3"
];
var soundNames={"BOOMBAMBOP.mp3":"BOOM BAM BOP","BRUH.mp3":"BRUH","DING.mp3":"DING","FBI OPEN UP.mp3":"FBI OPEN UP","HA!GOTEE!HA!.mp3":"HA! GOT EEE! HA!","Hello There.mp3":"Hello There","Hi How Are Ya.mp3":"Hi How Are Ya","HUH.mp3":"HUH?!","INCEPTION.mp3":"Inception","MEANWHILE.mp3":"Meanwhile","Metal Boom.mp3":"Metal Boom","MINECRAFT OOF.mp3":"Minecraft Oof","MY LEG.mp3":"MY LEG!","NO GOD PLEASE NO.mp3":"NO GOD PLEASE NO","NOPE.mp3":"NOPE","OH NO NO NO.mp3":"OH NO NO NO","OH!!!!!!!.mp3":"OH!!!!!!!","RIMSHOT.mp3":"Rimshot","Sadness-1.mp3":"Sadness 1","Sadness-2.mp3":"Sadness 2","Sadness-3.mp3":"Sadness 3","SHREK-SWAMP.mp3":"Shrek Swamp","TACTICAL NUKE.mp3":"TACTICAL NUKE","TBC.mp3":"To Be Continued","The Screaming Sheep.mp3":"Screaming Sheep","Titanic-Paroday.mp3":"Titanic Parody","Wait a minute....mp3":"Wait a minute…","WINDOWS-ERROR.mp3":"Windows Error","WINDOWS-STARTUP.mp3":"Windows Startup","WOW.mp3":"WOW","YEET.mp3":"YEET"};
var soundIcons=["zap","skull","bell","siren","laugh","user-round","hand","landmark","clapperboard","hourglass","bomb","pickaxe","footprints","frown","ban","triangle-alert","annoyed","drum","frown","frown","frown","leafy-green","radiation","timer","cloud","ship","eye","app-window","app-window","annoyed","bird"];
var currentSound=null;
function soundLabel(f){return soundNames[f]||f.replace(/\.mp3$/i,'').replace(/[-_]/g,' ')}
function stopSound(){if(currentSound){currentSound.pause();currentSound.currentTime=0;currentSound=null} $$(".sound.playing").forEach(function(b){b.classList.remove("playing")})}
function renderSounds(){
  var q=(($("#soundq")&&$("#soundq").value)||"").trim().toLowerCase();
  var out=[];
  soundFiles.forEach(function(f,i){var n=soundLabel(f);if(q&&n.toLowerCase().indexOf(q)<0)return;out.push('<button class="sound" data-sound="'+encodeURIComponent(f)+'"><span class="si">'+ic(soundIcons[i])+'</span><span><b>'+escapeHtml(n)+'</b><small>click to play</small></span></button>')});
  $("#soundgrid").innerHTML=out.join("")||'<p class="status">No sounds found.</p>';
  $$("#soundgrid .sound").forEach(function(b){b.onclick=function(){
    stopSound();
    var f=decodeURIComponent(b.dataset.sound);currentSound=new Audio("/memes/"+encodeURIComponent(f).replace(/%2F/g,"/"));b.classList.add("playing");
    currentSound.play().catch(function(){});currentSound.onended=function(){b.classList.remove("playing");currentSound=null};
  }});
}
function escapeHtml(x){return String(x).replace(/[&<>"']/g,function(c){return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]})}
$("#soundq").oninput=renderSounds;$("#stopSound").onclick=stopSound;renderSounds();

/* fog + cursor */
var fc=$("#fog"),fx=fc.getContext("2d"),blobs=[],W,H;
function size(){W=fc.width=innerWidth;H=fc.height=innerHeight}
size();addEventListener("resize",size);
for(var i=0;i<6;i++)blobs.push({x:Math.random(),y:Math.random(),r:.25+Math.random()*.25,dx:(Math.random()-.5)*.00025,dy:(Math.random()-.5)*.00025});
var vmBusy=false;   /* true while the VM tab is open: the fog stops so the emulator gets the CPU */
function fog(){
  if(S.fog&&!S.perf&&!vmBusy){
    fx.clearRect(0,0,W,H);
    blobs.forEach(function(b){
      b.x+=b.dx;b.y+=b.dy;if(b.x<-.1||b.x>1.1)b.dx*=-1;if(b.y<-.1||b.y>1.1)b.dy*=-1;
      var R=b.r*Math.max(W,H),g=fx.createRadialGradient(b.x*W,b.y*H,0,b.x*W,b.y*H,R);
      g.addColorStop(0,S.accent+"26");g.addColorStop(1,S.accent+"00");
      fx.fillStyle=g;fx.fillRect(0,0,W,H);
    });
  }
  requestAnimationFrame(fog);
}
fog();
addEventListener("pointermove",function(e){var g=$("#glow");g.style.left=e.clientX+"px";g.style.top=e.clientY+"px"});

/* games: 100 real browser games loaded through Rel Zone's proxy */
var stopFn=null;
function stopGame(){if(stopFn){stopFn();stopFn=null}var st=$("#stage");st.hidden=true;st.innerHTML=""}
var gameLinks=[
["1v1.LOL","https://1v1.lol/","crosshair"],["Drift Boss","https://driftboss.io/","car"],["Geometry Dash","https://www.geometrydash.com/","square"],["Slope","https://slopegame.io/","mountain-snow"],["Shell Shockers","https://shellshock.io/","egg"],["Krunker","https://krunker.io/","target"],["Agar.io","https://agar.io/","circle"],["Slither.io","https://slither.io/","worm"],["Diep.io","https://diep.io/","shield"],["Paper.io","https://paper-io.com/","file-text"],
["ZombsRoyale.io","https://zombsroyale.io/","ghost"],["Smash Karts","https://smashkarts.io/","car"],["Kour.io","https://kour.io/","target"],["Ev.io","https://ev.io/","zap"],["Venge.io","https://venge.io/","crosshair"],["Bullet Force","https://www.bulletforce.com/","zap"],["Forward Assault","https://www.forwardassault.io/","target"],["Repuls.io","https://repuls.io/","rocket"],["Voxiom.io","https://voxiom.io/","brick-wall"],["Bonk.io","https://bonk.io/","goal"],
["Gats.io","https://gats.io/","crosshair"],["Surviv.io","https://surviv.io/","hard-hat"],["Superhex.io","https://superhex.io/","hexagon"],["Little Big Snake","https://littlebigsnake.com/","worm"],["Wormate.io","https://wormate.io/","candy"],["Hole.io","https://holeio.com/","circle"],["Snowball.io","https://snowball.io/","snowflake"],["MooMoo.io","https://moomoo.io/","tree-pine"],["Starve.io","https://starve.io/","flame"],
["Narwhale.io","https://narwhale.io/","fish"],["Tetr.io","https://tetr.io/","puzzle"],["Chess.com","https://www.chess.com/play/computer","chess-pawn"],["Lichess","https://lichess.org/","chess-pawn"],["Skribbl.io","https://skribbl.io/","pencil"],["Gartic Phone","https://garticphone.com/","phone"],["Little Alchemy 2","https://littlealchemy2.com/","flask-conical"],["Cookie Clicker","https://orteil.dashnet.org/cookieclicker/","cookie"],["2048","https://2048game.com/","binary"],
["Hextris","https://hextris.io/","hexagon"],["Flappy Bird","https://flappybird.io/","bird"],["Moto X3M","https://motox3m.co/","bike"],["Vex 6","https://vex6.io/","footprints"],["Vex 7","https://vex7.io/","footprints"],["Vex 8","https://vex8.io/","footprints"],["Run 3","https://run3.io/","footprints"],["Tunnel Rush","https://tunnelrush.io/","tornado"],["Fireboy & Watergirl","https://fireboywatergirl.io/","flame"],["Action Games Hub","https://www.crazygames.com/c/action","gamepad-2"],
["Driving Games","https://www.crazygames.com/c/driving","car"],["Shooting Games","https://www.crazygames.com/c/shooting","crosshair"],["Multiplayer Games","https://www.crazygames.com/c/multiplayer","users"],["Racing Games","https://www.crazygames.com/c/racing","flag"],["Sports Games","https://www.crazygames.com/c/sports","goal"],["Puzzle Games","https://www.crazygames.com/c/puzzle","puzzle"],["Arcade Games","https://www.crazygames.com/c/arcade","joystick"],["IO Games","https://www.crazygames.com/c/io","globe"],["Two Player Games","https://www.crazygames.com/c/2-player","users"],["Strategy Games","https://www.crazygames.com/c/strategy","chess-pawn"],
["Action Games - Poki","https://poki.com/en/action","swords"],["Racing Games - Poki","https://poki.com/en/racing","car"],["Sports Games - Poki","https://poki.com/en/sports","circle-dot"],["2 Player Games - Poki","https://poki.com/en/two-player","users"],["Puzzle Games - Poki","https://poki.com/en/puzzle","puzzle"],["Arcade Games - Poki","https://poki.com/en/arcade","joystick"],["Adventure Games - Poki","https://poki.com/en/adventure","map"],["Shooting Games - Poki","https://poki.com/en/shooting","target"],[".io Games - Poki","https://poki.com/en/io","globe"],["New Games - Poki","https://poki.com/en/new","sparkles"],
["Action Games - Coolmath","https://www.coolmathgames.com/1-action-games","zap"],["Logic Games - Coolmath","https://www.coolmathgames.com/1-logic-games","brain"],["Skill Games - Coolmath","https://www.coolmathgames.com/1-skill-games","target"],["Strategy Games - Coolmath","https://www.coolmathgames.com/1-strategy-games","chess-pawn"],["Sports Games - Coolmath","https://www.coolmathgames.com/1-sports-games","circle-dot"],["Fireboy & Watergirl 2","https://www.coolmathgames.com/0-fireboy-and-water-girl-2","flame"],["Fireboy & Watergirl 3","https://www.coolmathgames.com/0-fireboy-and-water-girl-3","flame"],["Run 2","https://www.coolmathgames.com/0-run-2","footprints"],["Run 3 - Coolmath","https://www.coolmathgames.com/0-run-3","footprints"],["World's Hardest Game","https://www.coolmathgames.com/0-worlds-hardest-game","skull"],
["Papa's Pizzeria","https://www.coolmathgames.com/0-papas-pizzeria","pizza"],["Papa's Freezeria","https://www.coolmathgames.com/0-papas-freezeria","ice-cream-cone"],["Bloxorz","https://www.coolmathgames.com/0-bloxorz","box"],["Action Turnip","https://www.coolmathgames.com/0-action-turnip","carrot"],["Bob the Robber","https://www.coolmathgames.com/0-bob-the-robber","venetian-mask"],["Fireboy & Watergirl 4","https://www.coolmathgames.com/0-fireboy-and-water-girl-4","flame"],["Adventures of Pip","https://www.coolmathgames.com/0-adventures-of-pip","map"],["Soccer Random","https://www.coolmathgames.com/0-soccer-random","goal"],["Basket Random","https://www.coolmathgames.com/0-basket-random","circle-dot"],["Boxing Random","https://www.coolmathgames.com/0-boxing-random","hand-fist"],
["Drift Hunters","https://www.crazygames.com/game/drift-hunters","car"],["Super Star Car","https://www.crazygames.com/game/super-star-car","flag"],["Highway Traffic","https://www.crazygames.com/game/highway-traffic","car-front"],["Moto X3M Pool Party","https://www.crazygames.com/game/moto-x3m-pool-party","bike"],["Stickman Hook","https://www.crazygames.com/game/stickman-hook","anchor"],["Raft Wars","https://www.crazygames.com/game/raft-wars","sailboat"],["Action King: Draw Fight","https://www.crazygames.com/game/action-king-draw-fight","hand-fist"],["Getaway Shootout","https://www.crazygames.com/game/getaway-shootout","footprints"],["House of Hazards","https://www.crazygames.com/game/house-of-hazards","house"],["Masked Forces","https://www.crazygames.com/game/masked-forces","target"],["Bloxd.io","https://bloxd.io/","brick-wall"],["Miniblox","https://miniblox.io/","box"],["BuildNow GG","https://buildnow.gg/","crosshair"],["Zombs.io","https://zombs.io/","ghost"],["Hordes.io","https://hordes.io/","swords"],["Survivor.io","https://survivor.io/","ghost"],["Mope.io","https://mope.io/","paw-print"],["Chess Arena","https://www.chess.com/play/online","chess-pawn"]
];
function gameHue(name){var h=0;for(var i=0;i<name.length;i++)h=(h*31+name.charCodeAt(i))%360;return h}
function renderGames(){
  var host=$("#gamelist");host.innerHTML="";host.className="gtiles";
  gameLinks.forEach(function(g,i){
    var b=document.createElement("button");b.className="gt"+(i%11===0?" big":"");b.title=g[0];b.setAttribute("aria-label",g[0]);
    b.style.setProperty("--h",gameHue(g[0]));
    var fb=document.createElement("span");fb.className="gfb";fb.innerHTML=ic(g[2]);b.appendChild(fb);
    var im=new Image();im.className="art";im.alt="";im.decoding="async";im.loading="lazy";
    im.onload=function(){if(im.naturalWidth<160){b.classList.add("logo");b.style.setProperty("--bg",'url("'+im.src+'")')}b.classList.add("has")};
    im.onerror=function(){im.remove()};
    im.src="/api/thumb?u="+encodeURIComponent(g[1]);b.appendChild(im);
    b.onclick=function(){openGame(g[1],g[0])};host.appendChild(b)});
}
function openGame(url,name){openWeb(url)}
renderGames();

/* ai (served by the Node backend) */
var hist=[],busy=false,ctl=null;
var log=$("#log");
function addMsg(role,text){var m=document.createElement("div");m.className="msg "+role;m.textContent=text;log.appendChild(m);log.scrollTop=log.scrollHeight;return m}
function aiReset(){hist=[];log.innerHTML="";addMsg("bot","Hi! I'm Rel AI. What are we working on?")}
["Solve a problem","Check my work","Quiz me","Fix my writing"].forEach(function(t){
  var b=document.createElement("button");b.textContent=t;b.onclick=function(){$("#aiq").value=t+": ";$("#aiq").focus()};$("#chips").appendChild(b)});
async function ask(){
  var q=$("#aiq").value.trim();if(!q||busy)return;
  addMsg("me",q);$("#aiq").value="";
  hist.push({role:"user",content:q});
  var out=addMsg("bot","…"),acc="";busy=true;$("#aisend").disabled=true;
  try{
    ctl=new AbortController();
    var r=await fetch("/api/chat",{method:"POST",signal:ctl.signal,headers:{"Content-Type":"application/json"},
      body:JSON.stringify({messages:hist.slice(-12)})});
    if(!r.ok){var er=new Error("http");er.status=r.status;try{er.detail=(await r.json()).detail}catch(_){}throw er}
    var rd=r.body.getReader(),dec=new TextDecoder(),buf="";
    for(;;){
      var c=await rd.read();if(c.done)break;
      buf+=dec.decode(c.value,{stream:true});
      var lines=buf.split("\n");buf=lines.pop();
      lines.forEach(function(l){
        l=l.trim();if(l.indexOf("data:")!==0)return;
        var d=l.slice(5).trim();if(!d||d==="[DONE]")return;
        try{var t=JSON.parse(d).choices[0].delta.content;if(t){acc+=t;out.textContent=acc;log.scrollTop=log.scrollHeight}}catch(_){}
      });
    }
    if(!acc)throw new Error("empty");
    hist.push({role:"assistant",content:acc});
  }catch(e){
    if(e&&e.name==="AbortError")return;
    out.textContent=!e||!e.status?"Can't reach the Rel Zone server ("+((e&&e.message)||"no response")+"). Start it with npm start and open http://127.0.0.1:5000, not by double-clicking the HTML file.":
      e.status===429?"Rate limited. Wait a moment, then send again.":
      e.status===500?"Rel AI isn't set up on the server yet (missing GROQ_API_KEY in .env).":
      e.status===401||e.status===403?"Groq rejected the API key. It may be wrong or revoked. Make a new one and put it in .env, then restart the server.":
      "AI error ("+e.status+")"+(e.detail?": "+e.detail:"")+".";
    try{var hc=await (await fetch("/api/health")).json();
      out.textContent+="\n\nDiagnosis: "+(hc.problem||hc.result||"server check passed")}catch(_){}
    hist.pop();
  }
  busy=false;$("#aisend").disabled=false;
}
$("#aisend").onclick=ask;$("#aiq").onkeydown=function(e){if(e.key==="Enter")ask()};
$("#ainew").onclick=function(){if(ctl)ctl.abort();busy=false;$("#aisend").disabled=false;aiReset()};
aiReset();

/* global chat (WebSocket to /ws/chat on this server) */
var chatWs=null,chatTry=0,chatLog=$("#clog"),chatDot=$("#cdot");
function lsGet(k){try{return localStorage.getItem(k)}catch(_){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(_){}}
$("#cnick").value=lsGet("rz_nick")||"guest"+(1000+Math.floor(Math.random()*9000));
function chatOpen(){return $("#chat").classList.contains("on")}
function nearBottom(){return chatLog.scrollTop+chatLog.clientHeight>=chatLog.scrollHeight-80}
function trimChat(){while(chatLog.children.length>200)chatLog.removeChild(chatLog.firstChild)}
function addSys(text){var d=document.createElement("div");d.className="csys";d.textContent=text;chatLog.appendChild(d);trimChat();chatLog.scrollTop=chatLog.scrollHeight}
function addChat(m){
  var stick=m.me||nearBottom();
  var row=document.createElement("div");row.className="cmsg"+(m.me?" me":"");
  var h=document.createElement("div");h.className="ch";
  var n=document.createElement("b");n.textContent=m.nick;
  var t=document.createElement("small");t.textContent="#"+m.tag+" · "+new Date(m.ts*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  h.appendChild(n);h.appendChild(t);
  var b=document.createElement("div");b.className="cb";b.textContent=m.text;   /* text only, never HTML */
  row.appendChild(h);row.appendChild(b);chatLog.appendChild(row);trimChat();
  if(stick)chatLog.scrollTop=chatLog.scrollHeight;
}
function onChat(d){
  if(d.t==="history"){chatLog.innerHTML="";d.msgs.forEach(addChat);if(!d.msgs.length)addSys("No messages yet. Say hi!");chatLog.scrollTop=chatLog.scrollHeight}
  else if(d.t==="msg"){var empty=chatLog.firstChild&&chatLog.firstChild.className==="csys"&&/^No messages/.test(chatLog.firstChild.textContent);if(empty)chatLog.innerHTML="";addChat(d);if(!d.me&&!chatOpen())chatDot.hidden=false}
  else if(d.t==="online"){$("#conline").textContent="· "+d.n+" online"}
  else if(d.t==="you"){$("#cnick").value=d.nick;$("#callnick").value=d.nick;lsSet("rz_nick",d.nick)}
  else if(d.t==="error"){addSys(d.text)}
}
function chatConnect(){
  if(chatWs&&chatWs.readyState<2)return;
  $("#cstatus").textContent="connecting…";
  var ws=new WebSocket((location.protocol==="https:"?"wss":"ws")+"://"+location.host+"/ws/chat");chatWs=ws;
  ws.onopen=function(){chatTry=0;$("#cstatus").textContent="";ws.send(JSON.stringify({t:"hello",nick:$("#cnick").value}))};
  ws.onmessage=function(e){var d;try{d=JSON.parse(e.data)}catch(_){return}onChat(d)};
  ws.onclose=function(){if(chatWs!==ws)return;$("#conline").textContent="";$("#cstatus").textContent="disconnected, retrying…";setTimeout(chatConnect,Math.min(15000,1000*Math.pow(2,chatTry++)))};
  ws.onerror=function(){try{ws.close()}catch(_){}};
}
function chatOnShow(){chatDot.hidden=true;chatConnect()}
function chatSend(){
  var v=$("#cin").value.trim();if(!v)return;
  if(!chatWs||chatWs.readyState!==1){addSys("Not connected yet, one moment…");return}
  chatWs.send(JSON.stringify({t:"msg",text:v}));$("#cin").value="";
}
$("#csend").onclick=chatSend;$("#cin").onkeydown=function(e){if(e.key==="Enter")chatSend()};
$("#cnick").onchange=function(){syncNick(this.value)};

/* calls: WebRTC between browsers, set up over /ws/call on this server */
var cws=null,cTry=0,cWant=false,cMe=null,cIce=null,cMic=null,cCamTrack=null,cLocalStream=null;
var cRoom=null,cOutgoing=null,cPeers={},cInc=null,cMsgTimer=null,cCtx=null,cRingTimer=null,cWatch=[],cWatchTimer=null,cAvail=false;
var cLastLists={people:[],rooms:[]};
function callOk(){return window.isSecureContext&&navigator.mediaDevices&&window.RTCPeerConnection}
function envTag(){return location.protocol+"//"+location.host+(window.top!==window?" inside a frame":"")+(window.isSecureContext?"":" NOT secure")+("serviceWorker" in navigator?"":" no service workers")}
function callWhy(){
  if(!window.isSecureContext)return "Calls are blocked because this page isn't on a secure connection. Open the https:// address (the address bar should show a lock). ["+envTag()+"]";
  if(!navigator.mediaDevices)return "Your browser is blocking microphone access for this page. A school or work policy, or showing this site inside another site's frame, can cause this. ["+envTag()+"]";
  if(!window.RTCPeerConnection)return "WebRTC is turned off in your browser, so calls can't work. A privacy setting or extension usually does this. Try another browser. ["+envTag()+"]";
  return "";
}
function csend(o){if(cws&&cws.readyState===1)cws.send(JSON.stringify(o))}
function setCallMsg(t){var m=$("#callmsg");m.textContent=t||"";clearTimeout(cMsgTimer);if(t)cMsgTimer=setTimeout(function(){m.textContent=""},12000)}
function unlockAudio(){try{if(!cCtx)cCtx=new (window.AudioContext||window.webkitAudioContext)();if(cCtx.state==="suspended")cCtx.resume()}catch(_){}}
function initials(n){return (n||"?").trim().slice(0,2).toUpperCase()}
function syncNick(v){$("#cnick").value=v;$("#callnick").value=v;lsSet("rz_nick",v);
  if(cws&&cws.readyState===1)cws.send(JSON.stringify({t:"hello",nick:v}));
  if(typeof chatWs!=="undefined"&&chatWs&&chatWs.readyState===1)chatWs.send(JSON.stringify({t:"hello",nick:v}))}
$("#callnick").value=$("#cnick").value;
$("#callnick").onchange=function(){syncNick(this.value)};

/* ---- connection to the signalling server */
function cConnect(){
  cWant=true;
  if(cws&&cws.readyState<2)return;
  $("#callstat").textContent="· connecting…";
  var ws=new WebSocket((location.protocol==="https:"?"wss":"ws")+"://"+location.host+"/ws/call");cws=ws;
  ws.onopen=function(){cTry=0;$("#callstat").textContent="";ws.send(JSON.stringify({t:"hello",nick:$("#callnick").value}));if(cAvail)ws.send(JSON.stringify({t:"avail",on:true}))};
  ws.onmessage=function(e){var d;try{d=JSON.parse(e.data)}catch(_){return}onCall(d)};
  ws.onclose=function(){if(cws!==ws)return;if(cRoom||cOutgoing)endCall("Lost the connection to the server, so the call ended.",true);hideIncoming();
    $("#callstat").textContent="· disconnected, retrying…";cLastLists={people:[],rooms:[]};renderLists();if(cWant)setTimeout(cConnect,Math.min(15000,1000*Math.pow(2,cTry++)))};
  ws.onerror=function(){try{ws.close()}catch(_){}};
}
function callOnShow(){cConnect();if(!callOk())setCallMsg(callWhy())}
cAvail=lsGet("rz_avail")==="1";$("#callavail").checked=cAvail;
if(cAvail)setTimeout(cConnect,300);
$("#callavail").onchange=function(){cAvail=this.checked;lsSet("rz_avail",cAvail?"1":"0");unlockAudio();cConnect();csend({t:"avail",on:cAvail});renderLists()};

/* ---- lists */
function prow(){var r=document.createElement("div");r.className="prow";return r}
function renderLists(){
  var pe=$("#people"),ro=$("#roomlist");pe.innerHTML="";ro.innerHTML="";
  var others=(cLastLists.people||[]).filter(function(p){return !cMe||p.id!==cMe.id});
  function empty(host,t){var d=document.createElement("div");d.className="cempty";d.textContent=t;host.appendChild(d)}
  if(!cAvail)empty(pe,"Turn on “Available for calls” to see who else is around and to be reachable.");
  else if(!others.length)empty(pe,"Nobody else is available right now. Tell a friend to switch it on, or join a room.");
  others.forEach(function(p){var r=prow(),n=document.createElement("span");n.className="pn";n.textContent=p.nick+" ";var s=document.createElement("small");s.textContent="#"+p.tag+(p.busy?" · in a call":"");n.appendChild(s);
    var b=document.createElement("button");b.className="btn";b.innerHTML=ic("phone")+" call";b.disabled=!!p.busy||!!cRoom||!!cOutgoing;b.onclick=function(){callPerson(p.id)};r.appendChild(n);r.appendChild(b);pe.appendChild(r)});
  var rooms=cLastLists.rooms||[];
  if(!rooms.length)empty(ro,"No active rooms yet. Start one!");
  rooms.forEach(function(x){var r=prow(),n=document.createElement("span");n.className="pn";n.textContent=x.name+" ";var s=document.createElement("small");s.textContent="· "+x.count+" in the room";n.appendChild(s);
    var b=document.createElement("button");b.className="btn ghost";b.textContent="join";b.disabled=!!cRoom||!!cOutgoing;b.onclick=function(){joinRoom(x.name)};r.appendChild(n);r.appendChild(b);ro.appendChild(r)});
}

/* ---- local media */
async function ensureMic(){
  if(cMic&&cMic.readyState==="live")return true;
  if(!callOk()){setCallMsg(callWhy());return false}
  try{var s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});cMic=s.getAudioTracks()[0];return true}
  catch(e){cMic=null;setCallMsg(e&&e.name==="NotAllowedError"?"Microphone blocked. Click the lock icon in the address bar to allow it. You'll join as a listener.":e&&e.name==="NotFoundError"?"No microphone found. You'll join as a listener.":"Couldn't start the microphone. You'll join as a listener.");return "listen"}
}
async function getIce(){if(cIce)return cIce;try{cIce=await (await fetch("/api/ice")).json()}catch(_){cIce=[{urls:"stun:stun.l.google.com:19302"}]}return cIce}
function sendState(){csend({t:"state",mic:!!(cMic&&cMic.enabled),cam:!!cCamTrack});updateLocalTile()}

/* ---- tiles */
function mkTile(id,name,local){
  var t=document.createElement("div");t.className="ctile";t.dataset.id=id;
  var v=document.createElement("video");v.autoplay=true;v.playsInline=true;if(local)v.muted=true;
  var a=document.createElement("div");a.className="avatar";a.textContent=initials(name);
  var l=document.createElement("div");l.className="clabel";var mic=document.createElement("span");mic.className="micoff";mic.innerHTML=ic("mic-off");mic.hidden=true;var nm=document.createElement("span");nm.className="nm";nm.textContent=local?name+" (you)":name;l.appendChild(mic);l.appendChild(nm);
  var s=document.createElement("div");s.className="cstate";
  t.appendChild(v);t.appendChild(a);t.appendChild(l);t.appendChild(s);$("#ctiles").appendChild(t);return t;
}
function peerTile(id){var p=cPeers[id];if(!p)return null;if(!p.tile)p.tile=mkTile(id,(p.meta&&p.meta.nick)||"someone",false);return p.tile}
function paintTile(t,meta,stateText){
  if(!t||!meta)return;
  t.classList.toggle("cam",!!meta.cam);t.querySelector(".micoff").hidden=meta.mic!==false;
  t.querySelector(".avatar").textContent=initials(meta.nick);
  t.querySelector(".nm").textContent=meta.nick+(t.dataset.id==="me"?" (you)":"");
  if(stateText!==undefined)t.querySelector(".cstate").textContent=stateText;
}
function updateLocalTile(){var t=$('#ctiles [data-id="me"]');if(!t||!cMe)return;paintTile(t,{nick:cMe.nick,mic:!!(cMic&&cMic.enabled),cam:!!cCamTrack})}
function updateCount(){var n=Object.keys(cPeers).length+1;$("#callcount").textContent="· "+n+" in the room"}

/* ---- speaking highlight */
function watchLevel(stream,tile,isMuted){
  if(!cCtx||!stream.getAudioTracks().length)return;
  try{var an=cCtx.createAnalyser();an.fftSize=512;cCtx.createMediaStreamSource(stream).connect(an);cWatch.push({an:an,buf:new Uint8Array(an.fftSize),tile:tile,muted:isMuted});
    if(!cWatchTimer)cWatchTimer=setInterval(function(){cWatch.forEach(function(w){w.an.getByteTimeDomainData(w.buf);var s=0;for(var i=0;i<w.buf.length;i++){var x=(w.buf[i]-128)/128;s+=x*x}w.tile.classList.toggle("speaking",Math.sqrt(s/w.buf.length)>0.035&&!(w.muted&&w.muted()))})},150)}catch(_){}
}
function stopWatching(){cWatch=[];clearInterval(cWatchTimer);cWatchTimer=null}

/* ---- peer connections (full mesh; the person who joins last makes the offers) */
async function ensurePeer(id,offerer){
  var p=cPeers[id]||(cPeers[id]={meta:null,pending:[]});
  if(p.pc)return p;
  var pc=new RTCPeerConnection({iceServers:await getIce()});p.pc=pc;p.stream=new MediaStream();
  if(offerer){   /* the answerer attaches its tracks later, in armAnswerer(): transceivers made before a remote offer aren't matched to it */
    var ta=pc.addTransceiver("audio",{direction:"sendrecv"}),tv=pc.addTransceiver("video",{direction:"sendrecv"});p.vs=tv.sender;p.as=ta.sender;
    if(cMic)await ta.sender.replaceTrack(cMic);
    if(cCamTrack)await tv.sender.replaceTrack(cCamTrack);
  }
  var tile=peerTile(id),vid=tile.querySelector("video");
  pc.ontrack=function(e){p.stream.addTrack(e.track);if(vid.srcObject!==p.stream)vid.srcObject=p.stream;vid.play().catch(function(){});
    if(e.track.kind==="audio")watchLevel(p.stream,tile,function(){return p.meta&&p.meta.mic===false})};
  pc.onicecandidate=function(e){if(e.candidate)csend({t:"signal",to:id,data:{candidate:e.candidate}})};
  pc.onconnectionstatechange=function(){var s=pc.connectionState;
    tile.querySelector(".cstate").textContent=s==="connected"?"":s==="failed"?"connection failed":s==="disconnected"?"reconnecting…":"connecting…";
    if(s==="failed"&&p.offerer&&!p.restarted){p.restarted=true;pc.createOffer({iceRestart:true}).then(function(o){return pc.setLocalDescription(o)}).then(function(){csend({t:"signal",to:id,data:{sdp:pc.localDescription}})}).catch(function(){})}};
  p.offerer=offerer;paintTile(tile,p.meta,"connecting…");
  if(offerer){await pc.setLocalDescription(await pc.createOffer());csend({t:"signal",to:id,data:{sdp:pc.localDescription}})}
  return p;
}
/* Safety net: sometimes a camera that was already running when a peer connects delivers a couple of frames and then stalls
   (the picture freezes for the other person). A few seconds after the camera is attached we check that frames are really being
   encoded. If not: 1st try = detach and re-attach the track, 2nd/3rd try = get a fresh camera stream and swap it in (the same
   thing that always works when you turn the camera on during a call). */
var cLastRestart=0;
async function restartCamera(){
  if(!cCamTrack||Date.now()-cLastRestart<6000)return;cLastRestart=Date.now();
  try{
    var s=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:24}}});
    var nt=s.getVideoTracks()[0],old=cCamTrack;cCamTrack=nt;
    for(var id in cPeers){if(cPeers[id].vs)await cPeers[id].vs.replaceTrack(nt)}
    var lv=$('#ctiles [data-id="me"] video');if(lv){lv.srcObject=new MediaStream([nt]);lv.play().catch(function(){})}
    try{old.stop()}catch(_){}
  }catch(e){console.warn("camera restart failed",e)}
}
function videoWatchdog(p){
  if(!p||!p.pc||!p.vs)return;
  clearInterval(p.wd);var last=-1,tries=0;
  p.wd=setInterval(async function(){
    if(!cCamTrack||!p.pc||p.pc.connectionState==="closed"||tries>=4){clearInterval(p.wd);return}
    if(p.pc.connectionState!=="connected")return;
    var enc=0;try{(await p.pc.getStats()).forEach(function(r){if(r.type==="outbound-rtp"&&r.kind==="video")enc=r.framesEncoded||0})}catch(_){return}
    if(enc>last+2){last=enc;return}
    tries++;last=enc;
    if(tries===1){try{var t=cCamTrack;await p.vs.replaceTrack(null);await new Promise(function(r){setTimeout(r,200)});await p.vs.replaceTrack(t)}catch(_){}}
    else await restartCamera();
  },3000);
}
async function armAnswerer(p){
  var ts=p.pc.getTransceivers();
  for(var i=0;i<ts.length;i++){var t=ts[i],kind=t.receiver&&t.receiver.track&&t.receiver.track.kind;
    if(kind==="audio"){p.as=t.sender;t.direction="sendrecv";if(cMic)await t.sender.replaceTrack(cMic)}
    else if(kind==="video"){p.vs=t.sender;t.direction="sendrecv"}}   /* the camera is attached after the answer is applied, see onSignal */
}
async function flushPending(p){var q=p.pending.splice(0);for(var i=0;i<q.length;i++){try{await p.pc.addIceCandidate(q[i])}catch(_){}}}
async function onSignal(from,data){
  try{
    if(data.sdp){
      if(data.sdp.type==="offer"){var p=await ensurePeer(from,false);await p.pc.setRemoteDescription(data.sdp);await armAnswerer(p);await flushPending(p);await p.pc.setLocalDescription(await p.pc.createAnswer());csend({t:"signal",to:from,data:{sdp:p.pc.localDescription}});if(cCamTrack&&p.vs){await p.vs.replaceTrack(cCamTrack);videoWatchdog(p)}}
      else{var q=cPeers[from];if(q&&q.pc){await q.pc.setRemoteDescription(data.sdp);await flushPending(q)}}
    }else if(data.candidate){
      var r=cPeers[from]||(cPeers[from]={meta:null,pending:[]});
      if(r.pc&&r.pc.remoteDescription)r.pc.addIceCandidate(data.candidate).catch(function(){});else r.pending.push(data.candidate);
    }
  }catch(e){console.warn("signal error",e)}
}
function dropPeer(id){var p=cPeers[id];if(!p)return;clearInterval(p.wd);try{p.pc&&p.pc.close()}catch(_){}if(p.tile){cWatch=cWatch.filter(function(w){return w.tile!==p.tile});p.tile.remove()}delete cPeers[id];updateCount()}

/* ---- joining, leaving */
async function joinRoom(name){
  if(cRoom||cOutgoing)return;unlockAudio();
  var ok=await ensureMic();if(ok===false)return;
  csend({t:"join",room:name});
}
async function callPerson(id){
  if(cRoom||cOutgoing)return;unlockAudio();
  var ok=await ensureMic();if(ok===false)return;
  csend({t:"call",to:id});
}
function showRoomUI(name,note){
  $("#calllobby").hidden=true;$("#callroom").hidden=false;$("#callroomname").textContent=name.charAt(0)==="~"?"private call":"room: "+name;
  $("#callnote").textContent=note||"";$("#cmic").innerHTML=(cMic&&cMic.enabled)?ic("mic")+" mute":ic("mic-off")+" unmute";$("#cmic").disabled=!cMic;
  $("#ccam").innerHTML=cCamTrack?ic("camera-off")+" camera off":ic("camera")+" camera on";$("#callnav").classList.add("ok");$("#calldot").hidden=false;$("#calldot").classList.add("ok");
}
function endCall(msg,noSend){
  if(!noSend){if(cOutgoing)csend({t:"cancel",room:cOutgoing});if(cRoom||cOutgoing)csend({t:"leave"})}
  Object.keys(cPeers).forEach(dropPeer);stopWatching();
  if(cCamTrack){try{cCamTrack.stop()}catch(_){}cCamTrack=null}
  if(cMic){try{cMic.stop()}catch(_){}cMic=null}
  $("#ctiles").innerHTML="";cRoom=null;cOutgoing=null;stopRing();
  $("#callroom").hidden=true;$("#calllobby").hidden=false;$("#calldot").hidden=true;$("#calldot").classList.remove("ok");
  if(msg)setCallMsg(msg);renderLists();
}
$("#roomgo").onclick=function(){joinRoom($("#roomin").value)};
$("#roomin").onkeydown=function(e){if(e.key==="Enter")joinRoom($("#roomin").value)};
$("#cleave").onclick=function(){endCall("")};
$("#cmic").onclick=function(){if(!cMic)return;cMic.enabled=!cMic.enabled;$("#cmic").innerHTML=cMic.enabled?ic("mic")+" mute":ic("mic-off")+" unmute";sendState()};
$("#ccam").onclick=async function(){
  if(!cRoom)return;
  if(cCamTrack){try{cCamTrack.stop()}catch(_){}cCamTrack=null;for(var id in cPeers){if(cPeers[id].vs)cPeers[id].vs.replaceTrack(null).catch(function(){})}
    var lv=$('#ctiles [data-id="me"] video');if(lv)lv.srcObject=null}
  else{try{var s=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:24}}});cCamTrack=s.getVideoTracks()[0];
      for(var k in cPeers){if(cPeers[k].vs){await cPeers[k].vs.replaceTrack(cCamTrack);videoWatchdog(cPeers[k])}}
      var lv2=$('#ctiles [data-id="me"] video');if(lv2){lv2.srcObject=new MediaStream([cCamTrack]);lv2.play().catch(function(){})}}
    catch(e){setCallMsg(e&&e.name==="NotAllowedError"?"Camera blocked. Allow it in the address bar.":"Couldn't start the camera.");return}}
  $("#ccam").innerHTML=cCamTrack?ic("camera-off")+" camera off":ic("camera")+" camera on";sendState();
};

/* ---- incoming calls */
function beep(f,t0,dur){try{var o=cCtx.createOscillator(),g=cCtx.createGain();o.frequency.value=f;o.connect(g);g.connect(cCtx.destination);g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(0.07,t0+0.03);g.gain.linearRampToValueAtTime(0,t0+dur);o.start(t0);o.stop(t0+dur+0.05)}catch(_){}}
function startRing(){stopRing();if(!cCtx||cCtx.state!=="running")return;var go=function(){var t=cCtx.currentTime;beep(440,t,0.4);beep(480,t+0.45,0.4)};go();cRingTimer=setInterval(go,2200)}
function stopRing(){clearInterval(cRingTimer);cRingTimer=null}
function showIncoming(d){
  cInc=d;$("#incname").textContent=d.from.nick;$("#inctag").textContent=" #"+d.from.tag;$("#incoming").hidden=false;$("#calldot").hidden=false;$("#calldot").classList.remove("ok");startRing();
  document.title=d.from.nick+" is calling";
}
function hideIncoming(){cInc=null;$("#incoming").hidden=true;stopRing();document.title=BASE_TITLE;if(!cRoom){$("#calldot").hidden=true}}
var BASE_TITLE=document.title;
$("#incyes").onclick=async function(){
  if(!cInc||cRoom||cOutgoing)return;var room=cInc.room;unlockAudio();hideIncoming();
  var ok=await ensureMic();if(ok===false)return;csend({t:"join",room:room});
};
$("#incno").onclick=function(){if(!cInc)return;csend({t:"respond",room:cInc.room,accept:false});hideIncoming()};

/* ---- messages from the server */
function onCall(d){
  switch(d.t){
    case "you":cMe=d;if($("#callnick").value!==d.nick){$("#callnick").value=d.nick;$("#cnick").value=d.nick;lsSet("rz_nick",d.nick)}break;
    case "lists":cLastLists=d;renderLists();break;
    case "ringing":cOutgoing=d.room;csend({t:"join",room:d.room});break;
    case "incoming":if(cRoom||cOutgoing){csend({t:"respond",room:d.room,accept:false});break}showIncoming(d);break;
    case "joined":
      cRoom=d.room;cPeers={};$("#ctiles").innerHTML="";cMe=d.you;
      var me=mkTile("me",d.you.nick,true);paintTile(me,{nick:d.you.nick,mic:!!(cMic&&cMic.enabled),cam:false});
      if(cMic){var ls=new MediaStream([cMic]);watchLevel(ls,me,function(){return !(cMic&&cMic.enabled)})}
      showRoomUI(d.room,cOutgoing&&!d.peers.length?"Ringing… waiting for them to pick up.":(cMic?"":"You're listening only (no microphone)."));
      d.peers.forEach(function(p){cPeers[p.id]={meta:p,pending:[]};ensurePeer(p.id,true)});updateCount();sendState();break;
    case "peer-join":
      var q=cPeers[d.peer.id]||(cPeers[d.peer.id]={meta:null,pending:[]});q.meta=d.peer;var t=peerTile(d.peer.id);paintTile(t,d.peer);updateCount();$("#callnote").textContent=cMic?"":"You're listening only (no microphone).";cOutgoing=null;break;
    case "peer-leave":
      dropPeer(d.id);
      if(cRoom&&cRoom.charAt(0)==="~"&&!Object.keys(cPeers).length)endCall("The call ended.");break;
    case "peer-state":case "peer-info":
      var pid=d.id||d.peer.id,pp=cPeers[pid];if(pp){pp.meta=Object.assign(pp.meta||{},d.peer||{mic:d.mic,cam:d.cam});paintTile(peerTile(pid),pp.meta)}break;
    case "signal":onSignal(d.from,d.data);break;
    case "declined":endCall((d.nick||"They")+" declined the call.");break;
    case "missed":hideIncoming();endCall(cRoom||cOutgoing?"Nobody picked up.":"");break;
    case "cancelled":hideIncoming();break;
    case "busy":endCall((d.nick||"They")+" is in another call right now.");break;
    case "error":setCallMsg(d.text);break;
  }
}

/* VM: VirtualXP uses a per-browser IndexedDB copy of VirtualXP.iso; no server-side ISO bucket is needed. */
var vmFrame=$("#vmframe"),vmLoaded=false,vmDbPromise=null;
function vmBusySet(on){vmBusy=on;document.body.classList.toggle("vmbusy",on)}
function vmHalfix(){try{return vmFrame.contentWindow.halfix||null}catch(_){return null}}
function vmPause(p){var h=vmHalfix();if(h&&h.pause){try{h.pause(p)}catch(_){}}}
function vmOpenDb(){
  if(!window.indexedDB)return Promise.reject(new Error("This browser does not support local file storage."));
  if(!vmDbPromise)vmDbPromise=new Promise(function(resolve,reject){
    var req=indexedDB.open("rel-zone-vm-storage",1);
    req.onupgradeneeded=function(){var db=req.result;if(!db.objectStoreNames.contains("files"))db.createObjectStore("files")};
    req.onsuccess=function(){resolve(req.result)};req.onerror=function(){reject(req.error||new Error("Could not open browser storage."))};
  });
  return vmDbPromise;
}
function vmGetIso(){return vmOpenDb().then(function(db){return new Promise(function(resolve,reject){var tx=db.transaction("files","readonly"),req=tx.objectStore("files").get("VirtualXP.iso");req.onsuccess=function(){resolve(req.result||null)};req.onerror=function(){reject(req.error||new Error("Could not read the saved ISO."))}})});}
function vmPutIso(file){return vmOpenDb().then(function(db){return new Promise(function(resolve,reject){var tx=db.transaction("files","readwrite");tx.objectStore("files").put(file,"VirtualXP.iso");tx.oncomplete=function(){resolve()};tx.onerror=function(){reject(tx.error||new Error("Could not save the ISO."))};tx.onabort=function(){reject(tx.error||new Error("Browser storage quota may be full."))}})});}
function vmSetReady(ready){$("#vmstart").disabled=!ready;}
function vmEnter(){
  vmBusySet(true);
  if(vmLoaded){$("#vmsetup").hidden=true;$("#vmbar").hidden=false;vmFrame.hidden=false;vmPause(false);return}
  $("#vmsetup").hidden=false;$("#vmbar").hidden=true;vmFrame.hidden=true;vmSetReady(false);
  $("#vmuploadstatus").textContent="Checking this browser for a saved ISO…";
  vmGetIso().then(function(file){
    var ok=file&&file.size>0;
    vmSetReady(!!ok);
    $("#vmuploadstatus").textContent=ok?"VirtualXP.iso is already saved in this browser ("+(file.size/1048576).toFixed(1)+" MB). You can start Windows XP.":"No saved ISO found. Download VirtualXP.iso from pCloud, then choose the file here.";
  }).catch(function(err){$("#vmuploadstatus").textContent=err.message||"Could not check browser storage. Try a modern browser."});
}
function vmLeave(){vmBusySet(false);if(vmLoaded)vmPause(true)}
$("#vmiso").addEventListener("change",function(){
  var file=this.files&&this.files[0];if(!file)return;
  if(!/\.iso$/i.test(file.name)){this.value="";$("#vmuploadstatus").textContent="Please choose the VirtualXP.iso file.";return}
  if(!file.size){this.value="";$("#vmuploadstatus").textContent="That file is empty. Choose the ISO again.";return}
  vmSetReady(false);$("#vmuploadstatus").textContent="Saving VirtualXP.iso to this browser…";
  vmPutIso(file).then(function(){
    if(navigator.storage&&navigator.storage.persist){navigator.storage.persist().catch(function(){})}
    vmSetReady(true);$("#vmuploadstatus").textContent="Saved! VirtualXP.iso is stored in this browser ("+(file.size/1048576).toFixed(1)+" MB). You can start Windows XP.";
  }).catch(function(err){$("#vmuploadstatus").textContent="Could not save the ISO: "+(err.message||"browser storage is unavailable or full")+". Try another browser or free some storage."});
});
$("#vmstart").onclick=function(){
  if($("#vmstart").disabled||vmLoaded)return;
  vmLoaded=true;$("#vmsetup").hidden=true;$("#vmbar").hidden=false;vmFrame.hidden=false;
  $("#vmstatus").textContent="Loading VirtualXP from your saved browser ISO…";
  vmFrame.src="/virtualxp/VirtualXP.htm";
};
vmFrame.addEventListener("load",function(){if(vmLoaded)$("#vmstatus").textContent="Click the screen to use your mouse and keyboard (Esc gives the mouse back). It pauses while you're on other tabs."});
$("#vmcad").onclick=function(){var h=vmHalfix();if(h&&h.send_ctrlaltdel)h.send_ctrlaltdel()};
$("#vmfull").onclick=function(){try{vmFrame.requestFullscreen()}catch(_){}};
$("#vmreload").onclick=function(){if(!vmLoaded)return;$("#vmstatus").textContent="Restarting…";try{vmFrame.contentWindow.location.reload()}catch(_){vmFrame.src="/virtualxp/VirtualXP.htm"}};

/* web: full in-browser proxy (Scramjet + Wisp), with the basic /proxy as a fallback */
var mode=null,sj=null,sjFrame=null,sjInit=null;
var LITE="BASIC proxy: JavaScript and cookies are OFF, so most games won't run.";
var wh=[],wi=-1,expect=null,wf=$("#wframe"),wbar=$("#wurl"),wst=$("#wstatus");
function looksUrl(q){return /^https?:\/\//i.test(q)||/^[^\s\/]+\.[a-z]{2,}(\/\S*)?$/i.test(q)}
function fullUrl(input){return /^https?:\/\//i.test(input)?input:looksUrl(input)?"https://"+input:S.engine+encodeURIComponent(input)}
function liteUrl(input){
  if(looksUrl(input))return /^https?:\/\//i.test(input)?input:"https://"+input;
  var e=S.engine;
  if(e.indexOf("duckduckgo")>-1)e="https://html.duckduckgo.com/html/?q=";
  else if(e.indexOf("google")>-1)e="https://www.google.com/search?gbv=1&q=";
  return e+encodeURIComponent(input);
}
function loadScript(src){return new Promise(function(res,rej){var t=document.createElement("script");t.src=src;t.onload=res;t.onerror=function(){rej(new Error("couldn't load "+src))};document.head.appendChild(t)})}
function startProxy(){
  if(sjInit)return sjInit;
  sjInit=(async function(){
    if(!window.isSecureContext||!("serviceWorker" in navigator))throw new Error("the full proxy needs a secure page (https) with service workers, and this page has "+(window.isSecureContext?"no service workers":"no secure connection"));
    await loadScript("/scram/scramjet.all.js");await loadScript("/baremux/index.js");
    sj=new ($scramjetLoadController().ScramjetController)({files:{wasm:"/scram/scramjet.wasm.wasm",all:"/scram/scramjet.all.js",sync:"/scram/scramjet.sync.js"}});
    await sj.init();
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    var conn=new BareMux.BareMuxConnection("/baremux/worker.js");
    await conn.setTransport("/rzfetch/index.mjs",[{base:"/bare/"}]);
    sjFrame=sj.createFrame($("#sjframe"));
    sjFrame.addEventListener("urlchange",function(e){wbar.value=e.url;wst.textContent="full proxy (JavaScript + cookies on) · "+e.url});
    return true;
  })();
  sjInit.catch(function(){});
  return sjInit;
}
function liteLoad(url){expect=url;wbar.value=url;wst.textContent="loading (basic proxy)…";wf.src="/proxy?url="+encodeURIComponent(url)}
async function openWeb(input){
  input=input.trim();if(!input)return;
  show("web");wst.textContent="starting proxy…";
  try{
    await startProxy();
    mode="sj";wf.hidden=true;$("#sjframe").hidden=false;
    var u=fullUrl(input);wbar.value=u;wst.textContent="loading…";sjFrame.go(u);
  }catch(err){
    console.warn("full proxy unavailable:",err);
    mode="lite";$("#sjframe").hidden=true;wf.hidden=false;
    var t=liteUrl(input);wh=wh.slice(0,wi+1);wh.push(t);wi=wh.length-1;liteLoad(t);
    wst.textContent="Full proxy could not start: "+(err&&err.message||err)+" ["+envTag()+"] "+LITE;
  }
}
addEventListener("message",function(e){
  if(mode!=="lite"||e.source!==wf.contentWindow||!e.data||!e.data.rz||typeof e.data.url!=="string")return;
  var u=e.data.url;wbar.value=u;wst.textContent=LITE+" · "+u;
  if(expect!==null){expect=null;wh[wi]=u}
  else if(u!==wh[wi]){wh=wh.slice(0,wi+1);wh.push(u);wi=wh.length-1}
});
wf.onload=function(){if(mode==="lite"&&wst.textContent==="loading (basic proxy)…")wst.textContent="done"};
$("#sjframe").onload=function(){if(mode==="sj"&&/^loading/.test(wst.textContent))wst.textContent="full proxy (JavaScript + cookies on) · "+wbar.value};
$("#wgo").onclick=function(){openWeb(wbar.value)};
wbar.onkeydown=function(e){if(e.key==="Enter")openWeb(wbar.value)};
$("#wback").onclick=function(){if(mode==="sj")sjFrame.back();else if(wi>0){wi--;liteLoad(wh[wi])}};
$("#wreload").onclick=function(){if(mode==="sj")sjFrame.reload();else if(wi>=0)liteLoad(wh[wi])};

/* piano */
var ac=null,notes=[["C",261.63,"a"],["D",293.66,"s"],["E",329.63,"d"],["F",349.23,"f"],["G",392,"g"],["A",440,"h"],["B",493.88,"j"],["C",523.25,"k"]];
function play(f){
  try{ac=ac||new (window.AudioContext||window.webkitAudioContext)();if(ac.state==="suspended")ac.resume();
    var o=ac.createOscillator(),g=ac.createGain();o.type=$("#wave").value;o.frequency.value=f;
    g.gain.setValueAtTime(.0001,ac.currentTime);g.gain.exponentialRampToValueAtTime(.3,ac.currentTime+.02);g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+1.1);
    o.connect(g);g.connect(ac.destination);o.start();o.stop(ac.currentTime+1.2)}catch(e){}
}
var kb=$("#keys");
notes.forEach(function(n){var k=document.createElement("div");k.className="key";k.innerHTML=n[0]+"<br>&nbsp;"+n[2];k.dataset.k=n[2];
  function hit(){play(n[1]);k.classList.add("hit");setTimeout(function(){k.classList.remove("hit")},150)}
  k.onpointerdown=hit;k._hit=hit;kb.appendChild(k)});
addEventListener("keydown",function(e){
  if($("#music").classList.contains("on")&&!e.repeat){var k=kb.querySelector('[data-k="'+e.key.toLowerCase()+'"]');if(k)k._hit()}});

apply();
})();
