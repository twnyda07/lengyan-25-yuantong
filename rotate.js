/* 寶嚴觀照頁共用：全場輪替號碼
 * 所有手機向寺方後台領「下一個號碼」；號碼順序事先隨機洗好、全場共用，輪完一輪才重洗。
 * 後台 2.5 秒內沒回應（網路不通、後台忙）就改用這支手機自己的輪替（fallback），不讓人卡住。
 * 用法：const i = await BYRotate.next(API網址, "door25", ()=>fairPick("baoyan25_doorbag", 25));
 */
(function(){
  async function next(api, key, fallback, timeoutMs){
    var ctl = ("AbortController" in window) ? new AbortController() : null;
    var timer = setTimeout(function(){ if(ctl) ctl.abort(); }, timeoutMs || 2500);
    try{
      var r = await fetch(api, { method: "POST", headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "next", key: key }), signal: ctl ? ctl.signal : undefined });
      var j = await r.json();
      clearTimeout(timer);
      if(j && j.ok && Number.isInteger(j.idx)) return j.idx;
    }catch(_){}
    clearTimeout(timer);
    return fallback();
  }
  window.BYRotate = { next: next };
})();
