/* 寶嚴觀照頁共用：全場輪替號碼
 * 所有手機向寺方後台領「下一個號碼」；號碼順序事先隨機洗好、全場共用，輪完一輪才重洗。
 * 後台 4 秒內沒回應（網路不通、後台忙）就先改用這支手機自己的輪替（fallback），不讓人卡住。
 * 晚到的號碼不丟掉：後台已經把它發出去了，存起來給這支手機的下一位用，全場順序才不會跳號。
 * 後台回的號碼超出範圍（設定錯、部署指錯專案）一律不用，改用 fallback，畫面不會卡住。
 * 預先領號（11-15 現場發現）：後台回應常要 1.5～3 秒，手機網路慢時超過 2.5 秒就退回本機隨機，
 *   而來玩的人多半用自己的手機，本機輪替等於純隨機 → 全場重複。所以頁面一打開就先領號（warm），
 *   等到要用時號碼早已在手上；用掉一個就再預領下一個。預領但沒用到的號碼留在這支手機給下一位（30 分鐘內）。
 * 用法：BYRotate.warm(API網址, "door25");   // 頁面載入時
 *       const i = await BYRotate.next(API網址, "door25", ()=>fairPick("baoyan25_doorbag", 25));
 */
(function(){
  var N = { draw53: 53, face53: 53, bodhi: 7, door25: 25 };   // 各 key 的號碼數（號碼 0～N-1）
  var KEEP_MS = 30 * 60 * 1000;                               // 晚到的號碼保留 30 分鐘
  function valid(idx, n){ return Number.isInteger(idx) && idx >= 0 && (!n || idx < n); }
  function slot(key){ return "byrot_late_" + key; }
  function takeLate(key, n){
    try{
      var v = JSON.parse(localStorage.getItem(slot(key)) || "null");
      localStorage.removeItem(slot(key));
      if(v && valid(v.i, n) && Date.now() - v.t < KEEP_MS) return v.i;
    }catch(_){}
    return null;
  }
  function keepLate(key, idx){
    try{ localStorage.setItem(slot(key), JSON.stringify({ i: idx, t: Date.now() })); }catch(_){}
  }

  var inflight = {};   // key → 正在向後台領號的 Promise（resolve 時號碼已存進 late 槽）
  function request(api, key, n){
    return fetch(api, { method: "POST", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "next", key: key }) })
      .then(function(r){ return r.json(); })
      .then(function(j){ return (j && j.ok && valid(j.idx, n)) ? j.idx : null; })
      .catch(function(){ return null; });
  }
  /* 預先領號：結果存進這支手機的 late 槽，next() 直接拿。已有號碼或正在領就不重複領。 */
  function warm(api, key, n){
    n = n || N[key] || 0;
    if(!api || !n || inflight[key]) return;
    try{
      var v = JSON.parse(localStorage.getItem(slot(key)) || "null");
      if(v && valid(v.i, n) && Date.now() - v.t < KEEP_MS) return;
    }catch(_){}
    inflight[key] = request(api, key, n).then(function(idx){
      if(idx !== null) keepLate(key, idx);
      return idx;
    }).finally(function(){ delete inflight[key]; });
  }

  function next(api, key, fallback, timeoutMs, n){
    n = n || N[key] || 0;
    function useNow(v){ setTimeout(function(){ warm(api, key, n); }, 300); return v; }   // 用掉一個就預領下一個
    var late = takeLate(key, n);
    if(late !== null) return Promise.resolve(useNow(late));
    return new Promise(function(resolve){
      var done = false;
      function finish(v){ if(done) return false; done = true; clearTimeout(timer); resolve(useNow(v)); return true; }
      function useFallback(){ var v; try{ v = fallback(); }catch(_){ v = 0; } finish(v); }
      var timer = setTimeout(useFallback, timeoutMs || 4000);
      if(inflight[key]){
        // 預領還在路上：等它（最多到逾時），到了就從 late 槽拿
        inflight[key].then(function(){
          var v = takeLate(key, n);
          if(v !== null){ if(!finish(v)) keepLate(key, v); } else useFallback();
        });
        return;
      }
      // 不在逾時時中止請求：號碼晚到就留給下一位
      request(api, key, n).then(function(idx){
        if(idx !== null){ if(!finish(idx)) keepLate(key, idx); }
        else useFallback();
      });
    });
  }
  window.BYRotate = { next: next, warm: warm, N: N };
})();
