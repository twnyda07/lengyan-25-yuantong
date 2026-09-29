/* =============================================================================
   寄送觀照結果到 Email
   後端：Google Apps Script 網頁應用程式（見 apps-script/ 資料夾）
   -----------------------------------------------------------------------------
   前端只送「編號」（第幾門、旁通二門、掌相八觀分數），不送任何文案；
   信件內容一律由伺服器端依同一份 yuantong-data.js 重建，
   故此公開端點無法被拿來夾帶任意內容寄信。
   MAIL_API 留空時，整個寄送區塊不會出現，網站其餘功能照常。
   ========================================================================== */

const MAIL_API = "https://script.google.com/macros/s/AKfycbzbw0CVcqsMvbX5VYsO-seqZFgvRrC68sXVBB1Vs2b3niQafzr2o07JgXZM_gx04OJI-g/exec";

const BaoyanMail = (function(){
  const LS_KEY = "baoyan_yuantong_contact";

  function loadContact(){
    try{ return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }catch(_){ return {}; }
  }
  function saveContact(name, email){
    try{ localStorage.setItem(LS_KEY, JSON.stringify({name:name, email:email})); }catch(_){}
  }
  function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
  function newRid(){ return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2,10); }

  /* Apps Script 的轉址偶爾會令 fetch 失敗，故重試三次；
     後端見同一個 rid 即不重複寄信。 */
  async function post(payload){
    const body = JSON.stringify(payload);
    for(let i=0; i<3; i++){
      if(i) await new Promise(r=>setTimeout(r, 900*i));
      try{
        const res = await fetch(MAIL_API, {
          method:"POST",
          headers:{"Content-Type":"text/plain;charset=utf-8"},   // 用 text/plain 避開 CORS preflight
          body: body, redirect:"follow"
        });
        const txt = await res.text();
        try{ return JSON.parse(txt); }catch(_){ return {ok:false, msg:"回應格式有誤，請稍後再試。"}; }
      }catch(_){ /* 續試 */ }
    }
    try{   // 三次皆讀不到回應（如 App 內建瀏覽器擋跨網域）→ 盲送，同 rid 不會重複寄
      await fetch(MAIL_API, {method:"POST", mode:"no-cors",
        headers:{"Content-Type":"text/plain;charset=utf-8"}, body: body});
      return {ok:true, blind:true};
    }catch(_){
      return {ok:false, msg:"連線失敗，請確認網路後再試一次。"};
    }
  }

  /* payload：{n, trio:[i,i,i], feats:{八觀}, times} */
  function mount(box, payload){
    if(!MAIL_API){ box.style.display = "none"; return; }
    box.style.display = "block";
    const saved = loadContact();
    const esc = s => String(s||"").replace(/"/g,"&quot;");
    box.className = "mailbox";
    box.innerHTML = `
      <div class="mailbox-h">寄 一 份 到 我 的 信 箱</div>
      <p class="mailbox-p">留下稱呼與 Email，這一份<b>掌相八觀</b>與<b>所請圓通</b>的完整內容<br>
        ——含經文、文殊揀選、三學功課與見輝法師開示連結——即寄達您的信箱，以便隨時展讀、依之用功。</p>
      <div class="mailbox-f">
        <input type="text"  class="m-name" maxlength="30" placeholder="您的姓名或稱呼" value="${esc(saved.name)}" autocomplete="name">
        <input type="email" class="m-mail" maxlength="80" placeholder="您的 Email"     value="${esc(saved.email)}" autocomplete="email" inputmode="email">
        <label class="mailbox-agree"><input type="checkbox" class="m-ok" checked>
          <span>我同意寶嚴禪寺以此 Email 寄送本次觀照結果；日後若有法會、課程等法訊，亦歡迎通知我。</span></label>
        <button class="btn" type="button">寄 送 結 果</button>
      </div>
      <div class="mailbox-msg"></div>
      <div class="mailbox-note">※ 我們只保存您的姓名與 Email，供寄送與法訊之用；八問所答僅用於信中為您說明掌相特色。</div>`;

    const nameEl = box.querySelector(".m-name"), mailEl = box.querySelector(".m-mail"),
          okEl   = box.querySelector(".m-ok"),   btn    = box.querySelector(".btn"),
          msg    = box.querySelector(".mailbox-msg");
    const say = (t, c) => { msg.textContent = t; msg.className = "mailbox-msg " + (c||""); };

    btn.addEventListener("click", async ()=>{
      const name = nameEl.value.trim(), email = mailEl.value.trim();
      if(!name){ say("請留下您的姓名或稱呼。","bad"); nameEl.focus(); return; }
      if(!validEmail(email)){ say("Email 格式似乎不正確，請再檢查一次。","bad"); mailEl.focus(); return; }
      if(!okEl.checked){ say("請先勾選同意，我們才能寄信給您。","bad"); return; }

      btn.disabled = true; const label = btn.textContent; btn.textContent = "寄 送 中 …";
      say("正在為您寄出…","");
      if(!box.dataset.rid) box.dataset.rid = newRid();
      const res = await post(Object.assign({}, payload,
        {name:name, email:email, page:location.href, rid:box.dataset.rid}));
      if(res && res.ok){
        saveContact(name, email);
        box.classList.add("done");
        say("已寄出。請查收信箱（約一分鐘內；若未見，請看看「促銷」或「垃圾郵件」匣）。","ok");
      }else{
        btn.disabled = false; btn.textContent = label;
        say((res && res.msg) || "寄送失敗，請稍後再試。","bad");
      }
    });
  }

  return {mount:mount};
})();
