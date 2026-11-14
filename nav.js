/* 寶嚴觀照頁共用：頂端導覽列「← 回上頁｜目前位置｜↺ 下一位」
 * 展示區共用手機：前一位看完結果，下一位要一眼找到「重新開始」的路。
 * BYNav.mount({ crumb, parentUrl, theme:"dark"|"light", nextLabel, onBack, onNext })
 *   onBack()：頁內還有上一步（例如正在看結果）就回上一步並回傳 true；回傳 false 才離開本頁。
 *   onNext()：回到起點給下一位。
 * BYNav.setResult(true/false)：結果畫面時顯示「下一位」並在位置加「結果」。
 */
(function(){
  var opt = {}, bar, crumbEl, nextBtn, backBtn, inResult = false;

  function sameSiteReferrer(){
    try{ return document.referrer && new URL(document.referrer).host === location.host && history.length > 1; }
    catch(_){ return false; }
  }
  function canLeave(){ return sameSiteReferrer() || !!opt.parentUrl; }
  function refresh(){
    crumbEl.textContent = opt.crumb + (inResult ? " › 結果" : "");
    nextBtn.hidden = !inResult;
    backBtn.hidden = !inResult && !canLeave();
  }
  function goBack(){
    if(opt.onBack && opt.onBack()) { window.scrollTo({top:0, behavior:"smooth"}); return; }
    if(sameSiteReferrer()) history.back();
    else if(opt.parentUrl) location.href = opt.parentUrl;
  }

  function mount(o){
    opt = o || {};
    var dark = opt.theme !== "light";
    var st = document.createElement("style");
    st.textContent =
      ".bynav{position:fixed; top:0; left:0; right:0; z-index:50; display:flex; align-items:center; gap:8px;" +
      "padding:calc(env(safe-area-inset-top,0px) + 6px) 10px 6px; box-sizing:border-box; min-height:58px;" +
      (dark ? "background:rgba(7,11,30,.92); border-bottom:1px solid rgba(212,175,55,.45); color:#f3e0a3;"
            : "background:rgba(247,249,253,.95); border-bottom:1px solid #b3c2da; color:#131d33;") +
      "-webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px); font-family:inherit;}" +
      ".bynav button{font:inherit; font-size:16px; font-weight:700; min-height:46px; padding:0 14px; border-radius:23px; cursor:pointer;" +
      "white-space:nowrap; letter-spacing:.04em; -webkit-tap-highlight-color:transparent; touch-action:manipulation;" +
      (dark ? "color:#f3e0a3; background:transparent; border:1.5px solid #d4af37;"
            : "color:#1f4d8f; background:#fff; border:1.5px solid #1f4d8f;") + "}" +
      ".bynav button[hidden]{display:none;}" +
      ".bynav .bynav-next{margin-left:auto;" +
      (dark ? "color:#1a1405; background:linear-gradient(180deg,#f3e0a3,#d4af37); border-color:#d4af37;"
            : "color:#fff; background:#1f4d8f;") + "}" +
      ".bynav .bynav-crumb{flex:1 1 auto; min-width:0; font-size:15px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.9; text-align:center;}" +
      ".bynav-space{height:calc(env(safe-area-inset-top,0px) + 58px);}" +
      "html{scroll-padding-top:calc(env(safe-area-inset-top,0px) + 66px);}" +
      "@media print{ .bynav, .bynav-space{display:none !important;} }";
    document.head.appendChild(st);

    bar = document.createElement("nav");
    bar.className = "bynav"; bar.setAttribute("aria-label", "頁面導覽");
    bar.innerHTML = '<button type="button" class="bynav-back">← 回上頁</button>' +
      '<div class="bynav-crumb" aria-live="polite"></div>' +
      '<button type="button" class="bynav-next" hidden></button>';
    backBtn = bar.querySelector(".bynav-back");
    crumbEl = bar.querySelector(".bynav-crumb");
    nextBtn = bar.querySelector(".bynav-next");
    nextBtn.textContent = opt.nextLabel || "↺ 下一位";
    var sp = document.createElement("div"); sp.className = "bynav-space";
    document.body.insertBefore(sp, document.body.firstChild);
    document.body.insertBefore(bar, document.body.firstChild);

    backBtn.addEventListener("click", goBack);
    nextBtn.addEventListener("click", function(){
      if(opt.onNext) opt.onNext();
      window.scrollTo({top:0, behavior:"smooth"});
    });
    refresh();
  }

  window.BYNav = {
    mount: mount,
    setResult: function(v){ inResult = !!v; if(bar) refresh(); }
  };
})();
