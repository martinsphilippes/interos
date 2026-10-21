import "server-only";
/**
 * Chat do site: a janela do visitante (HTML próprio, leve, sem o pacote do INTEROS) e o script que o site da empresa
 * inclui. Todo texto do visitante e da equipe entra com textContent (nunca HTML). A página tem CSP própria: só fala
 * com o INTEROS e só pode ser colocada em iframe nos sites permitidos.
 */
import type { SiteChatConfig } from "@/domain/site-chat";

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Configuração pública da janela (nada além do que o visitante vê). */
function publicConfig(c: SiteChatConfig, key: string, pageUrl: string) {
  return { k: key, title: c.title, greeting: c.greeting, color: c.color, askEmail: c.askEmail, askPhone: c.askPhone, requireContact: c.requireContact, offlineMessage: c.offlineMessage, privacyNotice: c.privacyNotice, pageUrl };
}

export function chatEmbedHtml(c: SiteChatConfig, opts: { key: string; nonce: string; pageUrl: string; blocked: boolean }): string {
  const cfg = JSON.stringify(publicConfig(c, opts.key, opts.pageUrl)).replace(/</g, "\\u003c");
  const n = esc(opts.nonce);
  if (opts.blocked) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chat</title><style nonce="${n}">body{font:14px system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh;color:#475569;background:#fff}</style></head><body><p>Chat indisponível neste site.</p></body></html>`;
  }
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(c.title)}</title>
<style nonce="${n}">
:root{--c:${esc(c.color)};--bg:#fff;--fg:#0f172a;--muted:#64748b;--line:#e2e8f0;--soft:#f1f5f9}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--fg:#e2e8f0;--muted:#94a3b8;--line:#1e293b;--soft:#111a2e}}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg);display:flex;flex-direction:column}
header{background:var(--c);color:#fff;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px}
header h1{font-size:15px;margin:0;font-weight:600}
header button{background:transparent;border:0;color:#fff;font-size:20px;line-height:1;cursor:pointer;min-width:44px;min-height:44px}
main{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.note{font-size:12px;color:var(--muted);text-align:center}
.msg{max-width:82%;padding:8px 10px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}
.me{align-self:flex-end;background:var(--c);color:#fff;border-bottom-right-radius:4px}
.team{align-self:flex-start;background:var(--soft);border-bottom-left-radius:4px}
.who{display:block;font-size:11px;opacity:.8;margin-bottom:2px}
form{display:flex;flex-direction:column;gap:8px;padding:12px;border-top:1px solid var(--line)}
label{font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:4px}
input,textarea{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:9px 10px;min-height:44px}
textarea{resize:none;min-height:64px}
input:focus,textarea:focus{outline:2px solid var(--c);outline-offset:0}
.send{background:var(--c);color:#fff;border:0;border-radius:8px;padding:10px;font-weight:600;cursor:pointer;min-height:44px}
.send:disabled{opacity:.6;cursor:default}
.row{display:flex;gap:8px;align-items:flex-end}.row textarea{flex:1;min-height:44px;height:44px}
.err{color:#dc2626;font-size:12px;min-height:1em}
.hidden{display:none!important}
</style>
</head>
<body>
<header><h1 id="t"></h1><button type="button" id="x" aria-label="Fechar o chat">×</button></header>
<main id="m" aria-live="polite"></main>
<form id="f1" class="hidden" novalidate>
  <label>Seu nome<input id="nm" autocomplete="name" maxlength="80" required></label>
  <label id="le">E-mail<input id="em" type="email" autocomplete="email" maxlength="120"></label>
  <label id="lp">Telefone (com DDD)<input id="ph" type="tel" autocomplete="tel" maxlength="30"></label>
  <label>Sua mensagem<textarea id="ms" maxlength="2000" required></textarea></label>
  <p class="note" id="pv"></p>
  <p class="err" id="e1" role="alert"></p>
  <button class="send" id="b1" type="submit">Iniciar conversa</button>
</form>
<form id="f2" class="hidden" novalidate>
  <p class="err" id="e2" role="alert"></p>
  <div class="row"><textarea id="tx" maxlength="2000" aria-label="Mensagem" placeholder="Escreva sua mensagem"></textarea><button class="send" id="b2" type="submit">Enviar</button></div>
</form>
<script nonce="${n}">
(function(){
var C=${cfg};var KEY="interos_chat_"+C.k;var token=null;var last="";var seen={};var open=false;var unread=0;var timer=null;
try{token=localStorage.getItem(KEY)}catch(e){}
var $=function(id){return document.getElementById(id)};
$("t").textContent=C.title;$("pv").textContent=C.privacyNotice;
if(!C.askEmail)$("le").classList.add("hidden");if(!C.askPhone)$("lp").classList.add("hidden");
$("x").onclick=function(){parent.postMessage({type:"interos-chat:close"},"*")};
function note(text){var p=document.createElement("p");p.className="note";p.textContent=text;$("m").appendChild(p)}
function add(m){if(seen[m.id])return;seen[m.id]=1;var d=document.createElement("div");d.className="msg "+(m.from==="visitante"?"me":"team");if(m.from!=="visitante"){var w=document.createElement("span");w.className="who";w.textContent=m.author;d.appendChild(w)}d.appendChild(document.createTextNode(m.body));$("m").appendChild(d);if(m.at>last)last=m.at;if(m.from!=="visitante"&&!open){unread++;parent.postMessage({type:"interos-chat:unread",count:unread},"*")}$("m").scrollTop=$("m").scrollHeight}
function api(path,opts){opts=opts||{};opts.headers=Object.assign({"content-type":"application/json"},token?{"x-chat-token":token}:{},opts.headers||{});return fetch(path,opts).then(function(r){return r.json().then(function(j){j.status=r.status;return j})})}
function showChat(){$("f1").classList.add("hidden");$("f2").classList.remove("hidden")}
function poll(){if(!token)return;api("/api/chat/messages?k="+encodeURIComponent(C.k)+(last?"&after="+encodeURIComponent(last):"")).then(function(j){if(j.status===401){token=null;try{localStorage.removeItem(KEY)}catch(e){}start();return}if(!j.ok)return;(j.messages||[]).forEach(add);if(j.closed&&!$("m").dataset.closed){$("m").dataset.closed="1";note("Atendimento encerrado. Se precisar, é só escrever de novo.")}if(!j.closed)delete $("m").dataset.closed}).catch(function(){})}
function schedule(){clearInterval(timer);timer=setInterval(poll,open?4000:30000)}
function start(){$("m").textContent="";note(C.greeting);if(token){showChat();poll()}else{$("f1").classList.remove("hidden");$("f2").classList.add("hidden")}schedule()}
window.addEventListener("message",function(e){if(e.source!==parent||!e.data||e.data.type!=="interos-chat:open")return;open=!!e.data.open;if(open){unread=0;parent.postMessage({type:"interos-chat:unread",count:0},"*");poll();setTimeout(function(){($("f2").classList.contains("hidden")?$("nm"):$("tx")).focus()},50)}schedule()});
$("f1").onsubmit=function(ev){ev.preventDefault();$("e1").textContent="";$("b1").disabled=true;api("/api/chat/start",{method:"POST",body:JSON.stringify({k:C.k,name:$("nm").value,email:$("em").value||undefined,phone:$("ph").value||undefined,message:$("ms").value,pageUrl:C.pageUrl})}).then(function(j){$("b1").disabled=false;if(!j.ok){$("e1").textContent=j.error||"Não foi possível enviar.";return}token=j.token;try{localStorage.setItem(KEY,token)}catch(e){}showChat();poll()}).catch(function(){$("b1").disabled=false;$("e1").textContent="Sem conexão. Tente de novo."})};
function rid(){var a=new Uint8Array(12);crypto.getRandomValues(a);return Array.prototype.map.call(a,function(b){return("0"+b.toString(16)).slice(-2)}).join("")}
$("f2").onsubmit=function(ev){ev.preventDefault();var body=$("tx").value.trim();if(!body)return;$("e2").textContent="";$("b2").disabled=true;api("/api/chat/messages",{method:"POST",body:JSON.stringify({k:C.k,body:body,id:rid()})}).then(function(j){$("b2").disabled=false;if(!j.ok){$("e2").textContent=j.error||"Não foi possível enviar.";return}$("tx").value="";poll()}).catch(function(){$("b2").disabled=false;$("e2").textContent="Sem conexão. Tente de novo."})};
$("tx").addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("f2").requestSubmit()}});
start();
})();
</script>
</body>
</html>`;
}

/** Script do site: botão flutuante + janela (iframe) do chat. Configuração lida no INTEROS (cor, posição, título). */
export function chatWidgetJs(c: SiteChatConfig, origin: string, key: string): string {
  const cfg = JSON.stringify({ origin, k: key, color: c.color, side: c.position === "esquerda" ? "left" : "right", title: c.title }).replace(/</g, "\\u003c");
  return `(function(){
if(window.__interosChat)return;window.__interosChat=1;
var C=${cfg};var d=document;
var btn=d.createElement("button");btn.type="button";btn.setAttribute("aria-label",C.title);
btn.style.cssText="position:fixed;bottom:20px;"+C.side+":20px;z-index:2147483646;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;background:"+C.color+";color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center";
btn.innerHTML='<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
var badge=d.createElement("span");badge.style.cssText="position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;border-radius:10px;background:#dc2626;color:#fff;font:600 12px/20px system-ui,sans-serif;padding:0 5px;display:none";btn.appendChild(badge);
var box=d.createElement("div");
box.style.cssText="position:fixed;bottom:88px;"+C.side+":20px;z-index:2147483647;width:370px;height:560px;max-height:calc(100vh - 110px);border-radius:14px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.3);display:none;background:#fff";
var fr=d.createElement("iframe");fr.title=C.title;fr.style.cssText="width:100%;height:100%;border:0";
fr.src=C.origin+"/chat/embed?k="+encodeURIComponent(C.k)+"&u="+encodeURIComponent(location.href);
box.appendChild(fr);
function small(){return window.innerWidth<480}
function setOpen(v){box.style.display=v?"block":"none";if(v&&small()){box.style.cssText+=";width:100%;height:100%;max-height:none;bottom:0;"+C.side+":0;border-radius:0"}else if(v){box.style.width="370px";box.style.height="560px";box.style.bottom="88px";box.style[C.side]="20px";box.style.borderRadius="14px";box.style.maxHeight="calc(100vh - 110px)"}btn.style.display=v&&small()?"none":"flex";fr.contentWindow&&fr.contentWindow.postMessage({type:"interos-chat:open",open:v},C.origin)}
var opened=false;btn.onclick=function(){opened=!opened;setOpen(opened)};
window.addEventListener("message",function(e){if(e.origin!==C.origin||!e.data)return;if(e.data.type==="interos-chat:close"){opened=false;setOpen(false)}if(e.data.type==="interos-chat:unread"){badge.textContent=String(e.data.count);badge.style.display=e.data.count>0?"block":"none"}});
function mount(){d.body.appendChild(box);d.body.appendChild(btn)}
if(d.body)mount();else d.addEventListener("DOMContentLoaded",mount);
})();`;
}
