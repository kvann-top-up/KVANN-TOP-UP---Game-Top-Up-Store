const $=s=>document.querySelector(s);const $$=s=>document.querySelectorAll(s);
async function api(url,opt={}){const r=await fetch(url,{credentials:'include',headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d}
function toast(m){const t=$('#toast');if(!t)return;t.textContent=m;t.style.display='block';setTimeout(()=>t.style.display='none',2800)}
async function me(){return (await api('/api/auth/me')).user}
async function logout(){await api('/api/auth/logout',{method:'POST'});location.href='/'}
window.logout=logout;
