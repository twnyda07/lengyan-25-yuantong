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

  /* 姓名與 Email 一律不記在這台裝置：不寫入、不預先帶入，每位都要自己重打。
     展示區等共用裝置最怕上一位的資料留在欄位裡被下一位誤送。
     舊版曾把聯絡資料存進 localStorage，這裡順手把殘留的清掉。 */
  function purgeLegacyContact(){
    try{ localStorage.removeItem(LS_KEY); }catch(_){}
  }
  /* 給欄位一組隨機的 name，連瀏覽器自己的自動填入也不容易猜中要填哪一格 */
  function rnd(){ return Math.random().toString(36).slice(2,10); }
  function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
  function newRid(){ return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2,10); }

  /* Apps Script 的轉址偶爾會令 fetch 失敗，故重試三次；
     後端見同一個 rid 即不重複寄信。 */
  /* 每次連線的等待上限。沒有上限時，公共 Wi-Fi 擋住 script.google.com（不回應）
     按鈕會一直卡在「寄送中…」好幾分鐘。第一次給長一點：Apps Script 冷啟動加寄信本來就要幾秒。 */
  const WAIT = [20000, 12000, 12000], BLIND_WAIT = 10000, SLOW_HINT = 8000;
  const NET_FAIL = "連不上寄信服務。公共 Wi-Fi 常會擋住 Google 的寄信網址——" +
                   "請關掉 Wi-Fi、改用手機行動網路，再按一次「寄送結果」（不會重複寄）。";

  /* 送一次並讀完回應；超過 ms 毫秒就中止（讀回應本身也算在內） */
  async function once(body, ms, blind){
    const ctl = (typeof AbortController === "function") ? new AbortController() : null;
    const timer = ctl ? setTimeout(function(){ ctl.abort(); }, ms) : 0;
    try{
      const opt = {method:"POST", headers:{"Content-Type":"text/plain;charset=utf-8"},  // text/plain 避開 CORS preflight
                   body: body, signal: ctl ? ctl.signal : undefined};
      if(blind){ opt.mode = "no-cors"; await fetch(MAIL_API, opt); return ""; }
      opt.redirect = "follow";
      const res = await fetch(MAIL_API, opt);
      return await res.text();
    }finally{ clearTimeout(timer); }
  }

  async function post(payload, onSlow){
    const body = JSON.stringify(payload);
    const slow = setTimeout(function(){ if(onSlow) onSlow(); }, SLOW_HINT);
    try{
      let txt = null;
      for(let i=0; i<WAIT.length && txt===null; i++){
        if(i) await new Promise(r=>setTimeout(r, 900*i));
        try{ txt = await once(body, WAIT[i], false); }catch(_){ /* 逾時或被擋，續試 */ }
      }
      if(txt !== null){
        try{ return JSON.parse(txt); }
        catch(_){ return {ok:false, msg:"寄信服務暫時回應異常，請稍候再按一次；若仍不行，請改用手機行動網路。"}; }
      }
      // 三次皆讀不到回應（如 App 內建瀏覽器擋跨網域）→ 盲送，同 rid 不會重複寄
      try{ await once(body, BLIND_WAIT, true); return {ok:true, blind:true}; }
      catch(_){ return {ok:false, msg:NET_FAIL}; }
    }finally{ clearTimeout(slow); }
  }

  /* ── 備援：寄信服務連不上（公共 Wi-Fi 擋住、或當日配額用完）時，
        改用訪客手機自己的郵件 App／分享，把畫面上的結果寄給自己。完全不經過 script.google.com。 */
  let altStyled = false;
  function altCSS(){
    if(altStyled) return; altStyled = true;
    const st = document.createElement("style");
    st.textContent = ".mailbox [hidden]{display:none !important;}" +
      ".mailbox-alt{margin:14px auto 0; max-width:400px; padding-top:14px; border-top:1px dashed var(--line,#ccc);}" +
      ".mailbox-alt-t{font-size:15.5px; line-height:1.8; color:var(--ink,#131d33); margin-bottom:6px;}" +
      ".mailbox-alt .btn{display:block; width:100%; box-sizing:border-box; margin-top:9px; text-decoration:none; text-align:center;}";
    document.head.appendChild(st);
  }
  function resultText(root){
    const out = [];
    Array.prototype.forEach.call(root.children, function(el){
      if(el.matches(".mailbox, .nextgate, .row, button, script, style") || !el.getClientRects().length) return;
      const t = String(el.innerText || "").replace(/[ \t　]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if(t) out.push(t);
    });
    let s = out.join("\n\n");
    if(s.length > 2500) s = s.slice(0, 2500) + "\n……（全文請回網站觀看）";
    return s;
  }
  function altPack(root, name){
    return { subject: "【寶嚴禪寺】掌紋觀照．所請圓通 — " + name,
             body: name + " 菩薩 您好：\n\n" + resultText(root) + "\n\n" +
                   location.origin + location.pathname + "\n© 寶嚴禪寺" };
  }
  function mailtoHref(email, p){
    return "mailto:" + encodeURIComponent(email).replace(/%40/g, "@") +
      "?subject=" + encodeURIComponent(p.subject) +
      "&body=" + encodeURIComponent(p.body.replace(/\r?\n/g, "\r\n"));
  }

  /* payload：{n, trio:[i,i,i], feats:{八觀}, times} */
  function mount(box, payload){
    if(!MAIL_API){ box.style.display = "none"; return; }
    box.style.display = "block";
    purgeLegacyContact();
    const fid = rnd();
    /* 本次寄送的識別碼。務必是 mount 的區域變數，不可掛在 #mailBox 上——
       #mailBox 是頁面上固定的節點，「再觀照一次」不會重建它，
       識別碼若留在上面，下一位送出時會沿用前一位的 rid，
       後端（Code.gs 以 rid 去重，快取 600 秒）會判為重複而直接回 ok，
       信根本沒寄、名單也沒這一筆，畫面卻顯示「已寄出」。 */
    let rid = null, ridFor = null;
    box.className = "mailbox";
    box.innerHTML = `
      <div class="mailbox-h">寄 一 份 到 我 的 信 箱</div>
      <p class="mailbox-p">留下稱呼與 Email，這一份<b>掌相八觀</b>與<b>所請圓通</b>的完整內容<br>
        ——含經文、文殊揀選、三學功課與見輝法師開示連結——即寄達您的信箱，以便隨時展讀、依之用功。</p>
      <div class="mailbox-f">
        <input type="text"  class="m-name" name="n-${fid}" maxlength="30" placeholder="您的姓名或稱呼" autocomplete="off" autocorrect="off" spellcheck="false">
        <input type="email" class="m-mail" name="e-${fid}" maxlength="80" placeholder="您的 Email"     autocomplete="off" autocorrect="off" spellcheck="false" inputmode="email">
        <label class="mailbox-agree"><input type="checkbox" class="m-ok" checked>
          <span>我同意寶嚴禪寺以此 Email 寄送本次觀照結果；日後若有法會、課程等法訊，亦歡迎通知我。</span></label>
        <button class="btn" type="button">寄 送 結 果</button>
      </div>
      <div class="mailbox-msg"></div>
      <div class="mailbox-alt" hidden>
        <div class="mailbox-alt-t">不必等網路——也可以直接用您自己的手機保存這份結果：</div>
        <a class="btn ghost m-alt-mail" href="#">用手機的郵件 App 寄給自己</a>
        <button class="btn ghost m-alt-share" type="button" hidden>分享到 LINE／其他 App 保存</button>
      </div>
      <div class="mailbox-note">※ 姓名與 Email <b>不會記在這台裝置</b>，每位都請自行填寫（共用裝置請安心）。
        我們只在寺方保存，供寄送與法訊之用；掌相八觀僅用於信中為您說明掌相特色。</div>`;

    const nameEl = box.querySelector(".m-name"), mailEl = box.querySelector(".m-mail"),
          okEl   = box.querySelector(".m-ok"),   btn    = box.querySelector(".mailbox-f .btn"),
          msg    = box.querySelector(".mailbox-msg");
    const say = (t, c) => { msg.textContent = t; msg.className = "mailbox-msg " + (c||""); };

    altCSS();
    const alt = box.querySelector(".mailbox-alt"), altMail = box.querySelector(".m-alt-mail"),
          altShare = box.querySelector(".m-alt-share");
    const altRoot = box.closest("section") || box.parentElement;
    let altP = null;
    const hideAlt = ()=>{ alt.hidden = true; altMail.setAttribute("href", "#"); altP = null; };
    const showAlt = (name, email)=>{
      altP = altPack(altRoot, name);
      altMail.setAttribute("href", mailtoHref(email, altP));
      altShare.hidden = (typeof navigator.share !== "function");
      alt.hidden = false;
    };
    altMail.addEventListener("click", (e)=>{ if(!altP) e.preventDefault(); });
    altShare.addEventListener("click", ()=>{
      if(altP && navigator.share) navigator.share({title: altP.subject, text: altP.body}).catch(()=>{});
    });
    nameEl.addEventListener("input", hideAlt); mailEl.addEventListener("input", hideAlt);

    btn.addEventListener("click", async ()=>{
      const name = nameEl.value.trim(), email = mailEl.value.trim();
      if(!name){ say("請留下您的姓名或稱呼。","bad"); nameEl.focus(); return; }
      if(!validEmail(email)){ say("Email 格式似乎不正確，請再檢查一次。","bad"); mailEl.focus(); return; }
      if(!okEl.checked){ say("請先勾選同意，我們才能寄信給您。","bad"); return; }

      btn.disabled = true; const label = btn.textContent; btn.textContent = "寄 送 中 …";
      say("正在為您寄出…","");
      /* 同一組姓名＋Email 的重試共用 rid，避免重複寄信；
         改了 Email（例如逾時後發現打錯）就換新 rid，否則後端會當成重複而不寄到新信箱 */
      if(ridFor !== name + "\n" + email){ rid = newRid(); ridFor = name + "\n" + email; }
      const res = await post(Object.assign({}, payload,
        {name:name, email:email, page:location.href, rid:rid}),
        ()=>say("網路較慢，仍在為您寄出…（若您連的是公共 Wi-Fi，可改用手機行動網路）",""));
      if(res && res.ok){
        nameEl.value = ""; mailEl.value = "";   // 不留在畫面上給下一位看見
        hideAlt();
        box.classList.add("done");
        say("已寄出。請查收信箱（約一分鐘內；若未見，請看看「促銷」或「垃圾郵件」匣）。","ok");
      }else{
        btn.disabled = false; btn.textContent = label;
        /* 後端程式錯誤（英文技術訊息）不直接丟給信眾看：改用中文說明並導向下方備援；原文留在 title 與 console 供工作人員查 */
        const raw = (res && res.msg) || "";
        const tech = raw && !/[\u4e00-\u9fff]/.test(raw);
        if(tech) console.warn("[BaoyanMail] 後端錯誤：", raw);
        say(tech ? "寄信服務暫時故障，工作人員正在處理。請先用下方按鈕，把這份結果寄給自己或存到 LINE。"
                 : (raw || "寄送失敗，請稍後再試。"), "bad");
        msg.title = tech ? raw : "";
        showAlt(name, email);
      }
    });
  }

  return {mount:mount};
})();
