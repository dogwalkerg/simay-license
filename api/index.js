import { kv } from '@vercel/kv';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Master-Key',
};

const MASTER_KEY = process.env.MASTER_KEY || 'admin123';
const TOKEN = 'ko30re.916919.xyz';
const MK_KEY = 'config:master_key';
const CI_KEY = 'config:check_interval';

async function getMasterKey() {
    const saved = await kv.get(MK_KEY);
    return saved || MASTER_KEY;
}

async function getCheckInterval() {
    const v = await kv.get(CI_KEY);
    const n = parseInt(v || '10');
    return n > 0 ? n : 10;
}

// === Request helpers ===
function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
    });
}

function html(htmlStr, status = 200) {
    return new Response(htmlStr, {
        status,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

// === Main handler ===
export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const action = url.searchParams.get('action');
    const token = url.searchParams.get('token');

    // Token protection (non-API routes need token)
    if (!action && token !== TOKEN) {
        return Response.redirect('https://www.pku.edu.cn', 302);
    }

    try {
        // === PUBLIC ENDPOINTS ===
        if (action === 'health') {
            return json({ status: 'ok', time: Date.now() });
        }

        if (action === 'validate') {
            if (request.method !== 'POST') return json({ valid: false, message: 'Use POST' }, 405);
            const body = await request.json();
            const code = body?.code?.trim();
            if (!code) return json({ valid: false, message: 'Code required' });

            const key = 'code:' + code;
            const record = await kv.get(key);
            if (!record) return json({ valid: false, message: 'Not found' });
            const data = JSON.parse(record);
            if (!data.active) return json({ valid: false, message: 'Disabled' });
            if (Date.now() > new Date(data.expiresAt).getTime()) {
                return json({ valid: false, message: 'Expired', expiresAt: data.expiresAt });
            }

            data.useCount = (data.useCount || 0) + 1;
            data.lastLoginAt = new Date().toISOString();
            data.isOnline = true;
            await kv.set(key, JSON.stringify(data));

            const interval = await getCheckInterval();
            return json({
                valid: true, message: 'Valid',
                expiresAt: data.expiresAt, note: data.note || '',
                checkInterval: interval,
                lastLoginAt: data.lastLoginAt, isOnline: true,
            });
        }

        if (action === 'logout') {
            if (request.method !== 'POST') return json({ success: false, message: 'Use POST' }, 405);
            const body = await request.json();
            const code = body?.code?.trim();
            if (!code) return json({ success: false, message: 'Code required' });

            const key = 'code:' + code;
            const record = await kv.get(key);
            if (!record) return json({ success: false, message: 'Not found' });
            const data = JSON.parse(record);
            data.lastLogoutAt = new Date().toISOString();
            data.isOnline = false;
            await kv.set(key, JSON.stringify(data));
            return json({ success: true, message: 'Logged out' });
        }

        // === PROTECTED ENDPOINTS ===
        const headers = Object.fromEntries(request.headers);
        const inputKey = headers['x-master-key'] || '';
        const mk = await getMasterKey();
        if (inputKey !== mk) {
            return json({ success: false, message: 'Invalid MasterKey' }, 403);
        }

        switch (action) {
            case 'list': {
                const keys = await kv.keys('code:*');
                const codes = [];
                for (const key of keys) {
                    const v = await kv.get(key);
                    if (v) codes.push(JSON.parse(v));
                }
                codes.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
                return json({ success: true, codes });
            }

            case 'create': {
                const body = await request.json();
                const code = body?.code?.trim();
                const expiresAt = body?.expiresAt?.trim();
                const note = body?.note?.trim() || '';
                if (!code || !expiresAt) return json({ success: false, message: 'Missing code or expiresAt' });

                const key = 'code:' + code;
                const existing = await kv.get(key);
                if (existing) {
                    const data = JSON.parse(existing);
                    data.expiresAt = expiresAt;
                    data.note = note;
                    data.updatedAt = new Date().toISOString();
                    await kv.set(key, JSON.stringify(data));
                    return json({ success: true, message: 'Updated: ' + code });
                } else {
                    const data = {
                        code, expiresAt, note,
                        active: true, useCount: 0,
                        lastLoginAt: null, lastLogoutAt: null, isOnline: false,
                        createdAt: new Date().toISOString(), updatedAt: null,
                    };
                    await kv.set(key, JSON.stringify(data));
                    return json({ success: true, message: 'Created: ' + code });
                }
            }

            case 'delete': {
                const body = await request.json();
                const code = body?.code?.trim();
                if (!code) return json({ success: false, message: 'Code required' });
                await kv.del('code:' + code);
                return json({ success: true, message: 'Deleted: ' + code });
            }

            case 'getConfig': {
                const interval = await getCheckInterval();
                return json({ success: true, checkInterval: interval });
            }

            case 'setConfig': {
                const body = await request.json();
                const checkInterval = parseInt(body?.checkInterval || '0');
                if (checkInterval < 1) return json({ success: false, message: 'Min 1 minute' });
                await kv.set(CI_KEY, String(checkInterval));
                return json({ success: true, message: 'Set to ' + checkInterval + ' min' });
            }

            case 'batch': {
                const body = await request.json();
                const count = parseInt(body?.count || '1');
                if (count < 1 || count > 500) return json({ success: false, message: 'Range 1-500' });
                const expiresAt = body?.expiresAt?.trim();
                if (!expiresAt) return json({ success: false, message: 'Expiry required' });
                const note = body?.note?.trim() || '';
                const chars = '0123456789abcdefABCDEF';
                const created = [];

                for (let i = 0; i < count; i++) {
                    let code = null;
                    for (let t = 0; t < 100; t++) {
                        let cand = 'OSCAR-';
                        for (let j = 0; j < 20; j++) {
                            cand += chars[Math.floor(Math.random() * chars.length)];
                        }
                        const existing = await kv.get('code:' + cand);
                        if (!existing) { code = cand; break; }
                    }
                    if (!code) continue;
                    const data = {
                        code, expiresAt, note,
                        active: true, useCount: 0,
                        lastLoginAt: null, lastLogoutAt: null, isOnline: false,
                        createdAt: new Date().toISOString(), updatedAt: null,
                    };
                    await kv.set('code:' + code, JSON.stringify(data));
                    created.push(code);
                }
                return json({ success: true, message: 'Created ' + created.length + ' codes' });
            }

            default:
                return html(ADMIN_HTML);
        }
    } catch (err) {
        return json({ error: err.message }, 500);
    }
}

// === ADMIN HTML (same as CF Workers version) ===
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<script>if(localStorage.getItem('OSCAR_MK'))document.documentElement.classList.add('has-mk')</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OSCAR Auth Manager</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:#1e293b;border-radius:10px;padding:24px;width:100%;max-width:1200px;box-shadow:0 3px 16px rgba(0,0,0,.3)}
h1{font-size:20px;color:#38bdf8;margin-bottom:10px}
h2{font-size:15px;color:#94a3b8;margin:12px 0 6px}
.r{display:flex;gap:5px;align-items:center;margin-bottom:4px;flex-wrap:wrap}
.r input{flex:1;min-width:70px;margin-bottom:0}
.r button{width:auto;white-space:nowrap;margin-bottom:0}
input,select,button{padding:6px 10px;border:1px solid #334155;border-radius:4px;font-size:13px;background:#0f172a;color:#e2e8f0;outline:none}
input:focus,select:focus{border-color:#38bdf8}
button{background:#38bdf8;color:#0f172a;font-weight:600;cursor:pointer;border:none;padding:6px 12px}
button:hover{opacity:.85}
.danger{background:#ef4444;color:#fff}
.sec{background:#334155;color:#e2e8f0}
.purple{background:#a78bfa;color:#0f172a}
.msg{padding:5px 8px;border-radius:4px;margin:4px 0;font-size:12px;display:none}
.msg.o{background:#064e3b;color:#6ee7b7;display:block}
.msg.e{background:#7f1d1d;color:#fca5a5;display:block}
.stats{display:flex;gap:4px;margin-bottom:8px;font-size:12px;flex-wrap:wrap}
.stat{padding:3px 8px;background:#0f172a;border-radius:4px}
.sn{font-weight:600}
.gn{color:#4ade80}
.or{color:#fb923c}
.rd{color:#f87171}
.bl{color:#38bdf8}
.fl{display:flex;gap:4px;margin-bottom:6px;align-items:center}
.fl input{flex:1;padding:3px 6px;font-size:11px}
.fl select{width:auto;padding:3px 5px;font-size:11px;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:12px;margin-top:3px}
th,td{padding:5px 6px;text-align:left;border-bottom:1px solid #334155;word-break:break-all}
th{color:#94a3b8;font-weight:500}
td{color:#cbd5e1}
.ok{color:#4ade80}
.ex{color:#fb923c}
.di{color:#f87171}
.on{color:#38bdf8}
.of{color:#64748b}
.ep{color:#64748b;text-align:center;padding:15px;font-size:13px}
.pg{display:flex;justify-content:center;align-items:center;gap:5px;margin-top:8px;flex-wrap:wrap}
.pg button{padding:3px 8px;font-size:12px;min-width:26px}
.pg button.cur{background:#38bdf8;color:#0f172a}
.pg button:disabled{opacity:.4;cursor:default}
.pi{color:#94a3b8;font-size:12px}
.ft{margin-top:12px;padding-top:12px;border-top:1px solid #334155;font-size:11px;color:#64748b}
@media(max-width:640px){.card{padding:12px}.r{flex-direction:column}.r input,.r button{width:100%}}
</style></head>
<body><div class="card">
<div class="r" style="justify-content:space-between;margin-bottom:6px"><h1>OSCAR Auth Codes</h1><button class="sec" onclick="doLogout()" style="padding:5px 14px">Logout</button></div>
<div id="msg" class="msg"></div>
<div class="stats" id="bar"><span class="stat">All <b class="sn" id="sa">0</b></span><span class="stat">&#9679; Valid <b class="sn gn" id="sb">0</b></span><span class="stat">&#9679; Expiring <b class="sn or" id="sc">0</b></span><span class="stat">&#9679; Expired <b class="sn rd" id="sd">0</b></span><span class="stat">&#9679; Online <b class="sn bl" id="se">0</b></span></div>
<h2>+ Create Code</h2>
<div class="r"><input type="text" id="nc" placeholder="Code (auto if empty)" style="flex:2"><input type="date" id="ne" style="flex:0 0 140px"><input type="text" id="nn" placeholder="Note" style="flex:2"><button onclick="doCreate()">Create</button><button class="purple" onclick="doBatch()">Batch</button><button id="delBtn" class="danger" onclick="doPurge()" style="display:none">Purge</button></div>
<h2>Settings</h2>
<div class="r"><input type="number" id="ci" min="1" max="1440" placeholder="Check interval (min)" style="flex:0 0 200px"><button onclick="doSaveCfg()">Save</button></div>
<div id="cfgMsg" class="msg"></div>
<div class="fl"><input id="sch" type="text" placeholder="Search..."><select id="fil"><option value="all">All</option><option value="valid">Valid</option><option value="expired">Expired</option></select></div>
<h2>Code List</h2>
<div id="cl"><p class="ep">Loading...</p></div>
<div class="pg" id="pg" style="display:none"><button id="bf" onclick="gp(1)" disabled>First</button><button id="bp" onclick="gp(CP-1)" disabled>&lsaquo;</button><span id="pn"></span><button id="bn" onclick="gp(CP+1)" disabled>&rsaquo;</button><button id="bl" onclick="gp(TP)" disabled>Last</button><span class="pi" id="pi">0/0</span></div>
<div class="ft">Validate: POST /api?action=validate | Logout: POST /api?action=logout</div>
</div>
<script>
'use strict';
var C=[],FC=[],MK="",FIL="all",SCH="",PS=10,CP=1,TP=1,IT,API="";
(function(a){API=a})(window.location.origin);

function $(i){return document.getElementById(i)}
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function msg(t,y){var e=$("msg");if(!e)return;e.textContent=t;e.className="msg "+y;setTimeout(function(){e.style.display="none"},4000)}
function cmsg(t,y){var e=$("cfgMsg");if(!e)return;e.textContent=t;e.className="msg "+y;setTimeout(function(){e.style.display="none"},4000)}
function gr(){var c="0123456789abcdefABCDEF",s="";for(var i=0;i<20;i++)s+=c[Math.floor(Math.random()*c.length)];return "OSCAR-"+s}
function gMK(){var s=localStorage.getItem("OSCAR_MK");return s||""}
function ld(){
 MK=gMK();if(!MK){$("cl").innerHTML='<p class="ep">Login with MasterKey first</p>';return}
 $("cl").innerHTML='<p class="ep">Loading...</p>';
 fetch(API+"/api?action=list",{headers:{"X-Master-Key":MK}}).then(function(r){return r.json()}).then(function(d){if(!d.success){msg("Load fail: "+(d.message||"?"),"e");return}C=d.codes||[];af()}).catch(function(e){msg("Err: "+e.message,"e")})
}
function lc(){var d=new Date();d.setFullYear(d.getFullYear()+1);var el=$("ne");if(el&&!el.value)el.value=d.toISOString().slice(0,10);MK=gMK();if(!MK)return;fetch(API+"/api?action=getConfig",{headers:{"X-Master-Key":MK}}).then(function(r){return r.json()}).then(function(d){if(d.success)$("ci").value=d.checkInterval||10}).catch(function(){})}
function af(){var n=Date.now(),cs=C.slice();if(FIL==="valid")cs=cs.filter(function(x){return x.active&&new Date(x.expiresAt).getTime()>n});else if(FIL==="expired")cs=cs.filter(function(x){return !x.active||new Date(x.expiresAt).getTime()<=n});if(SCH){var q=SCH.toLowerCase();cs=cs.filter(function(x){return x.code.toLowerCase().indexOf(q)>=0||(x.note&&x.note.toLowerCase().indexOf(q)>=0)})}FC=cs;TP=Math.max(1,Math.ceil(FC.length/PS));CP=Math.min(CP,TP);if(CP<1)CP=1;rc();rp()}
function rc(){var n=Date.now(),a=C.length,v=0,x=0,d=0,o=0,i,c;for(i=0;i<C.length;i++){c=C[i];var et=new Date(c.expiresAt).getTime();if(!c.active||et<=n){d++}else{v++;if(et-n<604800000)x++}if(c.lastLoginAt&&(n-new Date(c.lastLoginAt).getTime())<180000)o++}$("sa").textContent=a;$("sb").textContent=v;$("sc").textContent=x;$("sd").textContent=d;$("se").textContent=o;var db=$("delBtn");if(db)db.style.display=d>0?"inline-block":"none";var st=(CP-1)*PS,en=Math.min(st+PS,FC.length),pd=FC.slice(st,en),html;if(!FC.length)html='<p class="ep">No codes</p>';else{html="<table><tr><th>Code</th><th>Expires</th><th>Status</th><th>Note</th><th>Uses</th><th>Last Login</th><th>Online</th><th>Action</th></tr>";pd.sort(function(a,b){return new Date(b.createdAt)-new Date(a.createdAt)});for(i=0;i<pd.length;i++){c=pd[i];var ex=n>new Date(c.expiresAt).getTime();var sc=ex?"ex":(c.active?"ok":"di");var stx=ex?"Expired":(c.active?"Valid":"Disabled");var ds=ex?"color:#f87171":(n+604800000>new Date(c.expiresAt).getTime()?"color:#fb923c":"");var ol=c.lastLoginAt&&(Date.now()-new Date(c.lastLoginAt).getTime())<180000;html+='<tr><td style="font-family:monospace;font-size:11px">'+esc(c.code)+'</td><td'+(ds?' style="'+ds+'"':"")+">"+esc((c.expiresAt||"").slice(0,10))+'</td><td class="'+sc+'">'+stx+'</td><td>'+esc(c.note||"-")+'</td><td>'+(c.useCount||0)+'</td><td>'+(c.lastLoginAt?new Date(c.lastLoginAt).toLocaleString():"-")+'</td><td class="'+(ol?"on":"of")+'">'+(ol?"Online":"Offline")+'</td><td><span onclick="doDel(this)" data-code="'+esc(c.code)+'" style="color:#ef4444;cursor:pointer;font-size:11px;text-decoration:underline">Del</span><span style="color:#64748b;margin:0 3px">|</span><span onclick="doEdit(this)" data-code="'+esc(c.code)+'" style="color:#fbbf24;cursor:pointer;font-size:11px;text-decoration:underline">Edit</span></td></tr>'}html+="</table>"}$("cl").innerHTML=html}
function rp(){var pg=$("pg");if(FC.length<=PS){pg.style.display="none";return}pg.style.display="flex";$("bf").disabled=CP<=1;$("bp").disabled=CP<=1;$("bn").disabled=CP>=TP;$("bl").disabled=CP>=TP;$("pi").textContent="P"+CP+"/"+TP;var html="",sp=Math.max(1,CP-4),eg=Math.min(TP,CP+4);if(sp>1){html+='<button onclick="gp(1)">1</button>';if(sp>2)html+='<span style="color:#64748b">...</span>'}for(var i=sp;i<=eg;i++){var cl=i===CP?"cur":"";html+='<button class="'+cl+'" onclick="gp('+i+')">'+i+"</button>"}if(eg<TP){if(eg<TP-1)html+='<span style="color:#64748b">...</span>';html+='<button onclick="gp('+TP+')">'+TP+"</button>"}$("pn").innerHTML=html}
function gp(p){if(p<1||p>TP)return;CP=p;rc();rp()}
function doCreate(){var c=$("nc").value.trim(),e=$("ne").value,n=$("nn").value.trim();MK=gMK();if(!MK){msg("Add MasterKey to localStorage first","e");return}if(!e){msg("Select expiry","e");return}if(!c){var f=false;for(var t=0;t<100;t++){var d=gr();if(!C||C.every(function(x){return x.code!==d})){c=d;f=true;break}}if(!f){msg("Cannot generate","e");return}}else if(C&&C.some(function(x){return x.code===c})){msg("Code exists","e");return}fetch(API+"/api?action=create",{method:"POST",headers:{"Content-Type":"application/json","X-Master-Key":MK},body:JSON.stringify({code:c,expiresAt:e+" 23:59:59",note:n})}).then(function(r){return r.json()}).then(function(d){if(d.success){msg("Created: "+c,"o");$("nc").value="";$("nn").value="";ld();lc()}else{msg("Fail: "+(d.message||"?"),"e")}}).catch(function(e){msg("Err: "+e.message,"e")})}
function doDel(el){var c=el.dataset.code;MK=gMK();if(!MK||!confirm("Delete?"))return;fetch(API+"/api?action=delete",{method:"POST",headers:{"Content-Type":"application/json","X-Master-Key":MK},body:JSON.stringify({code:c})}).then(function(r){return r.json()}).then(function(d){if(d.success){msg("Deleted","o");ld()}else{msg("Fail: "+d.message,"e")}}).catch(function(e){msg("Err: "+e.message,"e")})}
function doEdit(el){var c=el.dataset.code,it=null;if(C)for(var i=0;i<C.length;i++)if(C[i].code===c){it=C[i];break}if(!it)return;var ne=prompt("Expires:",(it.expiresAt||"").slice(0,10));if(!ne)return;var nn=prompt("Note:",it.note||"");MK=gMK();if(!MK)return;fetch(API+"/api?action=create",{method:"POST",headers:{"Content-Type":"application/json","X-Master-Key":MK},body:JSON.stringify({code:c,expiresAt:ne+" 23:59:59",note:nn||""})}).then(function(r){return r.json()}).then(function(d){if(d.success){msg("Updated","o");ld()}else{msg("Fail: "+d.message,"e")}}).catch(function(e){msg("Err: "+e.message,"e")})}
function doBatch(){var n=prompt("Count (1-500):","10");if(!n)return;n=parseInt(n);if(isNaN(n)||n<1||n>500){msg("Range 1-500","e");return}var e=$("ne").value;if(!e){msg("Select date","e");return}var nt=$("nn").value.trim();MK=gMK();if(!MK)return;fetch(API+"/api?action=batch",{method:"POST",headers:{"Content-Type":"application/json","X-Master-Key":MK},body:JSON.stringify({count:n,expiresAt:e+" 23:59:59",note:nt})}).then(function(r){return r.json()}).then(function(d){if(d.success){msg(d.message,"o");ld()}else{msg("Fail: "+d.message,"e")}}).catch(function(e){msg("Err: "+e.message,"e")})}
function doPurge(){if(!confirm("Delete ALL expired?"))return;MK=gMK();if(!MK)return;var n=Date.now(),ex=[];if(C)for(var i=0;i<C.length;i++)if(!C[i].active||new Date(C[i].expiresAt).getTime()<=n)ex.push(C[i]);if(!ex.length){msg("None expired","o");return}var dn=0,fl=0,t=ex.length;ex.forEach(function(x){fetch(API+"/api?action=delete",{method:"POST",headers:{"Content-Type":"application/json","X-Master-Key":MK},body:JSON.stringify({code:x.code})}).then(function(r){return r.json()}).then(function(d){if(d.success)dn++;else fl++;if(dn+fl>=t){msg("Purged "+dn+", fail "+fl,"o");ld()}}).catch(function(){fl++;if(dn+fl>=t){msg("Purged "+dn+", fail "+fl,"o");ld()}})})}
function doSaveCfg(){var v=parseInt($("ci").value);if(!v||v<1){cmsg("Min 1","e");return}MK=gMK();if(!MK)return;fetch(API+"/api?action=setConfig",{method:"POST",headers:{"Content-Type":"application/json","X-Master-Key":MK},body:JSON.stringify({checkInterval:v})}).then(function(r){return r.json()}).then(function(d){if(d.success){cmsg("Saved: "+d.message,"o");lc()}else{cmsg("Fail: "+d.message,"e")}}).catch(function(e){cmsg("Err: "+e.message,"e")})}
function doLogin(){var k=prompt("Enter MASTER_KEY:");if(!k)return;localStorage.setItem("OSCAR_MK",k);MK=k;ld();lc();msg("Logged in","o")}
function doLogout(){localStorage.removeItem("OSCAR_MK");MK="";$("cl").innerHTML='<p class="ep" style="cursor:pointer" onclick="doLogin()">[Click to enter MasterKey]</p>';msg("Logged out","o")}
(function(){var si=$("sch");if(si)si.addEventListener("input",function(){SCH=this.value.trim().toLowerCase();CP=1;af()});var se=$("fil");if(se)se.addEventListener("change",function(){FIL=this.value;CP=1;af()})})();
(function(){MK=gMK();if(MK){ld();lc()}else{$("cl").innerHTML='<p class="ep" style="cursor:pointer" onclick="doLogin()">[Click to enter MasterKey]</p>'}})();
function rt(){clearTimeout(IT);IT=setTimeout(function(){localStorage.removeItem("OSCAR_MK");MK="";msg("Session expired","e");$("cl").innerHTML='<p class="ep" style="cursor:pointer" onclick="doLogin()">[Click to re-enter MasterKey]</p>'},300000)}
document.addEventListener("mousemove",rt);document.addEventListener("click",rt);document.addEventListener("keypress",rt);rt();
</script></body></html>`;
