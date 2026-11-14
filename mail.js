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

  /* Apps Script 的轉址偶爾會令 fetch 失敗，故重試；後端見同一個 rid 即不重複寄信。 */
  /* 每次連線的等待上限。沒有上限時，公共 Wi-Fi 擋住 script.google.com（不回應）
     按鈕會一直卡在「寄送中…」好幾分鐘。第一次給長一點：Apps Script 冷啟動加寄信本來就要幾秒。
     全部加起來不超過 TOTAL（約 20 秒）；第 SLOW_HINT 毫秒還沒結果，就先把「用我的郵件 App 寄給自己」打開，不讓人乾等。 */
  const WAIT = [12000, 7000], TOTAL = 20000, SLOW_HINT = 8000;
  const NET_FAIL = "連不上寄信服務（公共 Wi-Fi 常會擋住）。請直接按下方「用我的郵件 App 寄給自己」；" +
                   "或關掉 Wi-Fi、改用行動網路，再按一次「寄送結果」（不會重複寄）。";
  /* 讀不到後台回應時，無法知道信到底有沒有寄出（後台壞掉、要重新授權、被 Wi-Fi 登入頁攔下都長這樣），
     一律不可說「已寄出」。 */
  const UNKNOWN = "無法確認信是否送達。若兩分鐘內沒收到信（也請看看「促銷／垃圾郵件」匣），" +
                  "請按下方「用我的郵件 App 寄給自己」，內容都已幫您填好。";

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

  /* 回傳：{ok:true} 確定寄出／{ok:false,msg} 確定沒寄出／{ok:null,msg} 無法確認（一律要給備援） */
  async function post(payload, onSlow){
    const body = JSON.stringify(payload);
    const t0 = Date.now(), left = function(){ return TOTAL - (Date.now() - t0); };
    const slow = setTimeout(function(){ if(onSlow) onSlow(); }, SLOW_HINT);
    try{
      let txt = null;
      for(let i=0; i<WAIT.length && txt===null && left() > 2500; i++){
        if(i) await new Promise(r=>setTimeout(r, 800));
        try{ txt = await once(body, Math.min(WAIT[i], left() - 2000), false); }catch(_){ /* 逾時或被擋，續試 */ }
      }
      if(txt !== null){
        let j = null;
        try{ j = JSON.parse(txt); }catch(_){ }
        if(!j || typeof j !== "object")   // 讀得到但不是後台的回應（例如 Wi-Fi 登入頁、Google 錯誤頁）
          return {ok:null, msg:UNKNOWN};
        if(j.ok === true) return {ok:true, dup:!!j.dup};
        if(j.pending) return {ok:null, msg:UNKNOWN};
        return {ok:false, msg:j.msg || ""};
      }
      /* 讀不到回應（App 內建瀏覽器擋跨網域時會這樣）→ 用 no-cors 再送一次（同 rid 後台不會重複寄）。
         no-cors 看不到回應內容，送得出去不代表寄得出去，所以只能說「無法確認」，並打開備援。 */
      try{ await once(body, Math.max(left(), 1500), true); return {ok:null, blind:true, msg:UNKNOWN}; }
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
      ".mailbox-alt .btn{display:block; width:100%; box-sizing:border-box; margin-top:9px; text-decoration:none; text-align:center; letter-spacing:.04em; text-indent:0; padding:13px 10px; font-size:16px;}";
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
    if(s.length > 6000) s = s.slice(0, 6000) + "\n……（全文請回網站觀看）";
    /* innerText 不含網址：把結果裡的外部連結（如見輝法師開示影片）另列在後 */
    const links = [];
    Array.prototype.forEach.call(root.querySelectorAll("a[href^='http']"), function(a){
      if(a.closest(".mailbox, .nextgate, .row")) return;
      const t = String(a.innerText || "").replace(/\s+/g, " ").trim();
      if(links.indexOf(a.href) < 0) links.push(t ? "▶ " + t + "\n" + a.href : a.href);
    });
    if(links.length) s += "\n\n" + links.join("\n\n");
    return s;
  }
  function altPack(root, name){
    return { subject: "【寶嚴禪寺】掌紋觀照．所請圓通 — " + name,
             body: name + " 菩薩 您好：\n\n" + resultText(root) + "\n\n" +
                   location.origin + location.pathname + "\n© 寶嚴山寶嚴禪寺" };
  }
  function mailtoHref(email, p){
    return "mailto:" + encodeURIComponent(email).replace(/%40/g, "@") +
      "?subject=" + encodeURIComponent(p.subject) +
      "&body=" + encodeURIComponent(p.body.replace(/\r?\n/g, "\r\n"));
  }

  /* 每次 mount／clear 都換一代：#mailBox 是固定節點，換下一位後仍在頁面上，
     所以不能只看 box.isConnected；等待中已換人時，上一位的寄送結果一律不再顯示。 */
  let gen = 0;
  function clear(box){
    gen++;
    if(box){ box.innerHTML = ""; box.className = "mailbox"; box.style.display = "none"; }
  }

  /* payload：{n, trio:[i,i,i], feats:{八觀}, times} */
  function mount(box, payload){
    const myGen = ++gen;
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
        <div class="mailbox-alt-t">直接用您自己的手機保存這份結果：</div>
        <a class="btn m-alt-mail" href="#">用我的郵件 App 寄給自己</a>
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
      try{ alt.scrollIntoView({behavior:"smooth", block:"nearest"}); }catch(_){}
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
      const stale = ()=> myGen !== gen || !box.isConnected;
      const res = await post(Object.assign({}, payload,
        {name:name, email:email, page:location.href, rid:rid}),
        ()=>{ if(stale()) return;
              say("網路較慢，仍在為您寄出…。不想等的話，可以直接按下方「用我的郵件 App 寄給自己」。","");
              showAlt(name, email); });
      if(stale()) return;   // 等待中已換下一位（結果區已清掉），不再顯示上一位的訊息
      if(res && res.ok === true){
        nameEl.value = ""; mailEl.value = "";   // 不留在畫面上給下一位看見
        hideAlt();
        box.classList.add("done");
        say("已寄出。請查收信箱（約一分鐘內；若未見，請看看「促銷」或「垃圾郵件」匣）。","ok");
      }else if(res && res.ok === null){
        /* 無法確認：不說「已寄出」，一定給備援；按鈕恢復可再按（同一組姓名＋Email 共用 rid，後台不會重複寄） */
        btn.disabled = false; btn.textContent = label;
        say(res.msg || "無法確認信是否送達，請按下方「用我的郵件 App 寄給自己」。", "bad");
        msg.title = res.blind ? "no-cors 盲送：看不到後台回應" : "";
        showAlt(name, email);
      }else{
        btn.disabled = false; btn.textContent = label;
        /* 後端程式錯誤（英文技術訊息）不直接丟給信眾看：改用中文說明並導向下方備援；原文留在 title 與 console 供工作人員查 */
        const raw = (res && res.msg) || "";
        const tech = raw && !/[\u4e00-\u9fff]/.test(raw);
        if(tech) console.warn("[BaoyanMail] 後端錯誤：", raw);
        say(tech ? "寄信服務暫停中。請按下方「用我的郵件 App 寄給自己」——收件人與內容都已幫您填好，在郵件畫面按「傳送」即可。"
                 : (raw || "寄送失敗，請稍後再試。"), "bad");
        msg.title = tech ? raw : "";
        showAlt(name, email);
      }
    });
  }

  return {mount:mount, clear:clear};
})();
