/* 寶嚴觀照頁共用：開鏡頭＋前後鏡頭切換（各品牌手機通用）
 * 為什麼要這支：
 *  - 部分 Android 品牌（多鏡頭機種）會忽略 facingMode，只靠它切換會一直停在同一顆鏡頭。
 *  - 很多 Android 機一次只能開一顆鏡頭，舊串流沒先關掉，第二顆會開失敗（NotReadableError）。
 *  - 所以：先關舊的 → 依「指定前後」試 → 對不上就依鏡頭名稱找 → 再不行就依序輪下一顆鏡頭。
 *  - 每次都檢查「真的換到別顆了沒」，沒換到就繼續試；全部失敗時把原鏡頭開回來，不讓畫面變黑。
 */
(function(){
  var md = navigator.mediaDevices;
  var FRONT = /front|user|face|selfie|前|自拍/i;
  var BACK  = /back|rear|environment|world|後/i;
  var state = { facing: null, deviceId: null };

  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function stop(s){ if(s){ try{ s.getTracks().forEach(function(t){ t.stop(); }); }catch(_){} } }
  function cams(){
    if(!md || !md.enumerateDevices) return Promise.resolve([]);
    return md.enumerateDevices().then(function(all){
      return all.filter(function(d){ return d.kind === "videoinput"; });
    }).catch(function(){ return []; });
  }
  function info(s){
    var t = s && s.getVideoTracks && s.getVideoTracks()[0];
    var st = (t && t.getSettings && t.getSettings()) || {};
    return { deviceId: st.deviceId || null, facing: st.facingMode || null, label: (t && t.label) || "" };
  }
  function guess(label){
    if(FRONT.test(label)) return "user";
    if(BACK.test(label)) return "environment";
    return null;
  }
  function facingOf(s){ var i = info(s); return i.facing || guess(i.label); }
  function fatal(e){ return e && (e.name === "NotAllowedError" || e.name === "SecurityError" || e.name === "PermissionDeniedError"); }
  function get(video){ return md.getUserMedia({ video: video, audio: false }); }

  // 依序試；權限被拒立刻丟出，其餘錯誤換下一種寫法
  async function attempt(list, accept){
    var last = null;
    for(var i = 0; i < list.length; i++){
      try{
        var s = await get(list[i]);
        if(!accept || accept(s)) return s;
        stop(s); await sleep(200);
      }catch(e){
        if(fatal(e)) throw e;
        last = e; await sleep(200);
      }
    }
    if(last) throw last;
    return null;
  }

  function remember(s, want){
    var i = info(s);
    state.deviceId = i.deviceId;
    state.facing = facingOf(s) || want || null;
  }

  // 開鏡頭：want = "user"（前）或 "environment"（後）
  async function open(want, old){
    stop(old); if(old) await sleep(250);
    var s = await attempt([
      { facingMode: { exact: want } },
      { facingMode: want },
      true
    ]);
    // 開到的鏡頭方向明確不對 → 依名稱找對的那顆
    var f = facingOf(s);
    if(f && f !== want){
      var list = await cams();
      var hit = list.filter(function(d){ return d.deviceId && guess(d.label) === want; })[0];
      if(hit){
        stop(s); await sleep(250);
        try{ s = await get({ deviceId: { exact: hit.deviceId } }); }
        catch(e){ if(fatal(e)) throw e; s = await get(true); }
      }
    }
    remember(s, want);
    return { stream: s, facing: state.facing };
  }

  // 切換到另一顆鏡頭
  async function flip(old){
    var before = info(old);
    var curId = before.deviceId || state.deviceId;
    var curFacing = facingOf(old) || state.facing || "user";
    var want = curFacing === "user" ? "environment" : "user";
    var list = await cams();

    stop(old); await sleep(300);   // 很多 Android 機要先放開舊鏡頭才開得了另一顆

    function changed(s){
      var i = info(s);
      if(curId && i.deviceId) return i.deviceId !== curId;
      var f = facingOf(s);
      return f ? f !== curFacing : false;
    }

    var tries = [{ facingMode: { exact: want } }];
    // 依鏡頭名稱找方向相符的（同方向有多顆時取第一顆，通常是主鏡頭）
    list.forEach(function(d){
      if(d.deviceId && d.deviceId !== curId && guess(d.label) === want) tries.push({ deviceId: { exact: d.deviceId } });
    });
    tries.push({ facingMode: want });
    // 名稱看不出方向的機種：依序輪到下一顆
    var ids = list.map(function(d){ return d.deviceId; }).filter(Boolean);
    var k = ids.indexOf(curId);
    for(var n = 1; n <= ids.length; n++){
      var id = ids[(Math.max(k, 0) + n) % ids.length];
      if(id !== curId) tries.push({ deviceId: { exact: id } });
    }

    var s = null;
    try{ s = await attempt(tries, changed); }
    catch(e){ if(fatal(e)) throw e; s = null; }

    if(!s){
      // 換不過去：把原本那顆開回來，不讓畫面變黑
      s = await attempt(curId ? [{ deviceId: { exact: curId } }, true] : [true]);
      remember(s, curFacing);
      return { stream: s, facing: state.facing, switched: false };
    }
    remember(s, want);
    return { stream: s, facing: state.facing, switched: true };
  }

  // 在觀照框右下角放「換鏡頭」按鈕；只有偵測到兩顆以上鏡頭才出現
  function attachSwitch(opt){
    var viewer = opt.viewer, video = opt.video;
    if(!document.getElementById("bycam-style")){
      var st = document.createElement("style"); st.id = "bycam-style";
      st.textContent =
        ".bycam-flip{position:absolute; right:10px; bottom:10px; z-index:5; display:none; align-items:center; gap:6px;" +
        "min-height:46px; min-width:46px; padding:0 14px; border-radius:23px; font:inherit; font-size:15px; font-weight:700;" +
        "color:#fff; background:rgba(0,0,0,.58); border:1px solid rgba(255,255,255,.7); cursor:pointer; letter-spacing:.06em;" +
        "-webkit-tap-highlight-color:transparent; touch-action:manipulation;}" +
        ".viewer.cam .bycam-flip:not([hidden]){display:inline-flex;}" +
        ".bycam-flip[disabled]{opacity:.55;}" +
        ".bycam-flip svg{width:20px; height:20px;}";
      document.head.appendChild(st);
    }
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "bycam-flip"; btn.hidden = true;
    btn.setAttribute("aria-label", "切換前後鏡頭");
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-3l-2-3H9L7 7H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z"/><path d="M9 13a3 3 0 0 1 5.2-2"/><path d="M15 13a3 3 0 0 1-5.2 2"/><path d="M14.5 9.5v1.6h-1.6"/><path d="M9.5 16.5v-1.6h1.6"/></svg><span>換鏡頭</span>';
    viewer.appendChild(btn);

    btn.addEventListener("click", async function(){
      if(btn.disabled) return;
      btn.disabled = true;
      var label = btn.querySelector("span"); label.textContent = "切換中…";
      try{
        var r = await flip(opt.getStream());
        opt.setStream(r.stream);
        video.srcObject = r.stream;
        try{ await video.play(); }catch(_){}
        if(!r.switched && opt.onError) opt.onError("這支手機的瀏覽器不讓網頁切換鏡頭，請用目前這顆鏡頭拍攝" + (opt.hint ? "，" + opt.hint : "") + "。");
      }catch(e){
        if(opt.onError) opt.onError("切換鏡頭沒有成功，請再按一次「換鏡頭」" + (opt.hint ? "，" + opt.hint : "") + "。");
      }finally{
        label.textContent = "換鏡頭"; btn.disabled = false;
      }
    });

    // 開鏡頭後呼叫：有兩顆以上才顯示
    return {
      refresh: function(){
        return cams().then(function(list){ btn.hidden = list.length < 2; return list.length; });
      },
      hide: function(){ btn.hidden = true; }
    };
  }

  window.BYCam = { open: open, flip: flip, attachSwitch: attachSwitch, _state: state };
})();
