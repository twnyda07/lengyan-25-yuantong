/* 寶嚴觀照頁共用：全場輪替號碼
 * 所有手機向寺方後台領「下一個號碼」；號碼順序事先隨機洗好、全場共用，輪完一輪才重洗。
 * 後台 2.5 秒內沒回應（網路不通、後台忙）就先改用這支手機自己的輪替（fallback），不讓人卡住。
 * 晚到的號碼不丟掉：後台已經把它發出去了，存起來給這支手機的下一位用，全場順序才不會跳號。
 * 後台回的號碼超出範圍（設定錯、部署指錯專案）一律不用，改用 fallback，畫面不會卡住。
 * 用法：const i = await BYRotate.next(API網址, "door25", ()=>fairPick("baoyan25_doorbag", 25));
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

  function next(api, key, fallback, timeoutMs, n){
    n = n || N[key] || 0;
    var late = takeLate(key, n);
    if(late !== null) return Promise.resolve(late);
    return new Promise(function(resolve){
      var done = false;
      function finish(v){ if(done) return false; done = true; clearTimeout(timer); resolve(v); return true; }
      function useFallback(){ var v; try{ v = fallback(); }catch(_){ v = 0; } finish(v); }
      var timer = setTimeout(useFallback, timeoutMs || 2500);
      // 不在逾時時中止請求：號碼晚到就留給下一位
      fetch(api, { method: "POST", headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "next", key: key }) })
        .then(function(r){ return r.json(); })
        .then(function(j){
          if(j && j.ok && valid(j.idx, n)){ if(!finish(j.idx)) keepLate(key, j.idx); }
          else useFallback();
        })
        .catch(useFallback);
    });
  }
  window.BYRotate = { next: next, N: N };
})();
