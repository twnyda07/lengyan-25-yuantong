/* =============================================================================
   楞嚴二十五圓通．掌紋觀照 ── 結果寄送信箱（Google Apps Script 後端）
   -----------------------------------------------------------------------------
   ‧ 前端（mail.js）只送「編號」：所請之門、旁通二門、掌相八觀分數。
     信件內容一律由本檔依 Data.gs（＝網站同一份 yuantong-data.js）重建，
     所以這個公開端點不可能被拿來夾帶任意內容寄信。
   ‧ 每封寄出同時記錄到 Google 試算表，做為名單。
   ‧ 首次使用請先執行一次 setup()，會自動建立試算表並印出網址。
   ========================================================================== */

const CFG = {
  SITE:        "https://twnyda07.github.io/lengyan-25-yuantong/",
  SENDER_NAME: "寶嚴禪寺",
  REPLY_TO:    "",
  SS_NAME:     "楞嚴二十五圓通．寄送名單",
  SHEET_NAME:  "寄送紀錄",
  MAX_PER_EMAIL_PER_DAY: 5,
  MAX_TOTAL_PER_DAY:     400,
  ADMIN_PW:    "baoyan2026",
  ADMIN_MAX_FAIL_PER_DAY: 25,
  ADMIN_MAX_ROWS: 3000
};

const HEAD = ["時間","姓名","Email","所請之門","門名","法門","第幾次","掌相八觀","來源頁","狀態"];

/* ============ 入口 ============ */

function doGet() {
  return HtmlService.createHtmlOutput(
    '<meta charset="utf-8"><div style="font-family:sans-serif;padding:24px">' +
    '楞嚴二十五圓通 · 寄送服務運作中。</div>');
}

function doPost(e) {
  let out;
  try {
    const p = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    if (p.action === "list") return json_(listForAdmin_(p.pw));

    const req = validate_(p);

    const rid = String(p.rid || "").replace(/[^\w\-]/g, "").slice(0, 64);
    const cache = CacheService.getScriptCache();
    if (rid && cache.get("rid:" + rid)) return json_({ ok: true, dup: true });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      checkQuota_(req.email);
      if (MailApp.getRemainingDailyQuota() < 5) {
        throw new Error("今日寄信量已達上限，請明日再試，或直接截圖保存結果。");
      }
      const mail = buildMail_(req);
      MailApp.sendEmail({
        to: req.email, subject: mail.subject, htmlBody: mail.html, body: mail.text,
        name: CFG.SENDER_NAME, replyTo: CFG.REPLY_TO || undefined
      });
      bumpQuota_(req.email);
      log_(req, "已寄出");
      if (rid) cache.put("rid:" + rid, "1", 600);
    } finally {
      lock.releaseLock();
    }
    out = { ok: true };
  } catch (err) {
    out = { ok: false, msg: String((err && err.message) || err) };
  }
  return json_(out);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
                       .setMimeType(ContentService.MimeType.JSON);
}

/* ============ 驗證 ============ */

function validate_(p) {
  const name  = String(p.name  || "").trim().slice(0, 30);
  const email = String(p.email || "").trim().slice(0, 80);
  if (!name) throw new Error("請留下姓名或稱呼。");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error("Email 格式不正確。");

  const n = Number(p.n);
  if (!(n >= 1 && n <= 25)) throw new Error("門號超出範圍。");

  const trio = (Array.isArray(p.trio) ? p.trio : [])
      .map(Number).filter(function (i) { return i >= 0 && i <= 24; }).slice(0, 3);

  const feats = {};
  PALM_KEYS.forEach(function (k) {
    const v = Number((p.feats || {})[k]);
    feats[k] = (v >= 0 && v <= 100) ? Math.round(v) : 50;
  });

  const times = Math.max(1, Math.min(999, Number(p.times) || 1));
  const page  = String(p.page || "").slice(0, 200);
  return { name: name, email: email, n: n, trio: trio, feats: feats, times: times, page: page };
}

/* ============ 寄信配額 ============ */

function today_() {
  return Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd");
}
function checkQuota_(email) {
  const props = PropertiesService.getScriptProperties();
  const d = today_();
  if (Number(props.getProperty("total:" + d) || 0) >= CFG.MAX_TOTAL_PER_DAY) {
    throw new Error("今日寄送量已滿，請明日再試。");
  }
  const key = "cnt:" + d + ":" + email.toLowerCase();
  if (Number(props.getProperty(key) || 0) >= CFG.MAX_PER_EMAIL_PER_DAY) {
    throw new Error("同一信箱今日寄送次數已達上限，請明日再試。");
  }
}
function bumpQuota_(email) {
  const props = PropertiesService.getScriptProperties();
  const d = today_();
  const key = "cnt:" + d + ":" + email.toLowerCase();
  props.setProperty(key, String(Number(props.getProperty(key) || 0) + 1));
  props.setProperty("total:" + d, String(Number(props.getProperty("total:" + d) || 0) + 1));
}

/* ============ 名單試算表 ============ */

function setup() {
  const sh = sheet_();
  Logger.log("試算表已就緒：" + sh.getParent().getUrl());
}

function sheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty("ssId");
  let ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(CFG.SS_NAME);
    props.setProperty("ssId", ss.getId());
  }
  let sh = ss.getSheetByName(CFG.SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CFG.SHEET_NAME);
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
  }
  return sh;
}

function log_(req, status) {
  try {
    const y = doorByN_(req.n);
    const palm = PALM_KEYS.map(function (k) {
      return PALM_META[k].label + req.feats[k];
    }).join(" ");
    sheet_().appendRow([
      Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss"),
      req.name, req.email, req.n, y.name, y.gate, req.times, palm, req.page, status
    ]);
  } catch (e) { /* 記錄失敗不影響寄信 */ }
}

/* ============ 工作人員後台 ============ */

function adminPw_() {
  return PropertiesService.getScriptProperties().getProperty("adminPassword") || CFG.ADMIN_PW;
}
function listForAdmin_(pw) {
  const props = PropertiesService.getScriptProperties();
  const failKey = "pwfail:" + today_();
  const fails = Number(props.getProperty(failKey) || 0);
  if (fails >= CFG.ADMIN_MAX_FAIL_PER_DAY) {
    return { ok: false, msg: "今日密碼錯誤次數過多，後台已暫時鎖住，請明日再試。" };
  }
  if (String(pw || "") !== adminPw_()) {
    props.setProperty(failKey, String(fails + 1));
    Utilities.sleep(1200);
    return { ok: false, msg: "密碼不正確。" };
  }
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, rows: [], head: HEAD, total: 0 };
  const n = Math.min(last - 1, CFG.ADMIN_MAX_ROWS);
  const vals = sh.getRange(last - n + 1, 1, n, HEAD.length).getValues();
  const rows = vals.map(function (r) {
    return r.map(function (c) {
      return (c instanceof Date)
        ? Utilities.formatDate(c, "Asia/Taipei", "yyyy-MM-dd HH:mm:ss") : String(c);
    });
  }).reverse();
  return { ok: true, head: HEAD, rows: rows, total: last - 1 };
}

/* ============ 組信 ============ */

function doorByN_(n) {
  for (var i = 0; i < YUANTONG.length; i++) if (YUANTONG[i].n === n) return YUANTONG[i];
  throw new Error("查無此門。");
}

function esc_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildMail_(req) {
  const y = doorByN_(req.n);
  const others = req.trio.slice(1, 3).map(function (i) { return YUANTONG[i]; })
                    .filter(function (x) { return x && x.n !== y.n; });

  /* 掌相八觀 */
  const palmRows = PALM_KEYS.map(function (k) {
    const m = PALM_META[k], v = req.feats[k];
    return '<tr>'
      + '<td style="padding:6px 10px 6px 0;color:#5d5648;white-space:nowrap">' + esc_(m.label) + '</td>'
      + '<td style="padding:6px 0;width:100%">'
      +   '<div style="background:#e9e1d1;border-radius:5px;height:9px;max-width:300px">'
      +     '<div style="background:#9a7b3f;border-radius:5px;height:9px;width:' + v + '%"></div></div>'
      +   '<div style="font-size:13px;color:#8b8271;padding-top:2px">' + esc_(v >= 50 ? m.hi : m.lo) + '</div>'
      + '</td></tr>';
  }).join("");

  const ordered = PALM_KEYS.slice().sort(function (a, b) {
    return Math.abs(req.feats[b] - 50) - Math.abs(req.feats[a] - 50);
  });
  const traits = ordered.slice(0, 3).map(function (k) {
    const m = PALM_META[k];
    return '<p style="margin:0 0 8px;line-height:1.9;color:#5d5648">'
      + '<b style="color:#241f18">' + esc_(m.label) + '｜</b>'
      + esc_(req.feats[k] >= 50 ? m.hiTxt : m.loTxt) + '</p>';
  }).join("");

  const repeat = req.times > 1
    ? '<p style="margin:0 0 16px;padding:10px 14px;border:1px solid rgba(63,107,74,.4);'
      + 'background:rgba(63,107,74,.07);border-radius:3px;color:#3f6b4a;line-height:1.85">'
      + '此為第 <b>' + req.times + '</b> 次觀照。掌相與前次相近，判為同一人，故仍得此門——'
      + '同門再現，非是巧合，正可添幾分信心，依之用功。</p>'
    : '';

  const h2 = function (t) {
    return '<div style="font-size:13px;letter-spacing:.22em;color:#9a7b3f;font-weight:bold;'
      + 'margin:26px 0 8px;padding-bottom:6px;border-bottom:1px solid #ddd2ba">' + t + '</div>';
  };
  const three = function (k, label, color, txt) {
    return '<table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:9px;border:1px solid #ddd2ba;border-radius:3px">'
      + '<tr><td style="width:64px;vertical-align:top;padding:12px 10px">'
      +   '<div style="background:' + color + ';color:#fff;text-align:center;font-weight:bold;'
      +   'font-size:14px;letter-spacing:.14em;border-radius:2px;padding:4px 0">' + label + '</div></td>'
      + '<td style="padding:12px 14px 12px 0;line-height:1.9;color:#241f18">' + esc_(txt) + '</td></tr></table>';
  };

  const html =
      '<div style="font-family:\'Noto Serif TC\',\'Songti TC\',serif;background:#f2ece0;padding:24px 14px">'
    + '<div style="max-width:620px;margin:0 auto;background:#fbf8f1;border:1px solid #ddd2ba;'
    +   'border-radius:4px;padding:28px 26px;color:#241f18;font-size:16px;line-height:1.9">'

    + '<div style="text-align:center;font-size:13px;letter-spacing:.5em;color:#9a7b3f">寶 嚴 禪 寺</div>'
    + '<div style="text-align:center;font-size:23px;font-weight:bold;margin-top:12px;letter-spacing:.06em">'
    +   '楞嚴二十五圓通．掌紋觀照</div>'
    + '<p style="margin:18px 0 0;color:#5d5648">' + esc_(req.name) + ' 菩薩：<br>'
    +   '以下是您這一次觀照的完整內容，謹此奉上。</p>'

    + h2('您 的 掌 相 八 觀')
    + '<table cellpadding="0" cellspacing="0" style="width:100%">' + palmRows + '</table>'
    + '<div style="margin-top:14px;padding-top:12px;border-top:1px dashed #ddd2ba">' + traits + '</div>'
    + '<p style="font-size:13.5px;color:#8b8271;margin:10px 0 0">'
    +   '此八觀但述您掌中的特色與性情之所偏，不論吉凶，亦非命理預測。</p>'

    + h2('所 請 之 圓 通')
    + repeat
    + '<div style="text-align:center;padding:6px 0 4px">'
    +   '<div style="display:inline-block;font-size:12.5px;letter-spacing:.22em;color:#fbf8f1;'
    +     'background:#33405e;padding:3px 14px;border-radius:2px">' + esc_(y.cat) + '圓通</div>'
    +   '<div style="font-size:34px;margin:14px 0 4px">' + y.icon + '</div>'
    +   '<div style="font-size:24px;font-weight:bold">' + esc_(y.name) + '</div>'
    +   '<div style="font-size:16px;color:#9a7b3f;letter-spacing:.18em;margin-top:6px">' + esc_(y.gate) + '</div>'
    +   '<div style="display:inline-block;margin-top:14px;border-top:1px solid #cbbca0;border-bottom:1px solid #cbbca0;'
    +     'padding:8px 20px;font-size:20px;font-weight:bold;letter-spacing:.28em">' + esc_(y.seal) + '</div>'
    +   '<div style="font-size:12.5px;color:#8b8271;letter-spacing:.16em;margin-top:12px">'
    +     '二十五圓通之第 ' + y.n + ' 門　·　入門處：' + esc_(y.door) + '</div>'
    + '</div>'

    + h2('經 文 ． 聖 者 自 陳')
    + '<div style="background:#f2ece0;border-left:3px solid #9a7b3f;padding:14px 16px;line-height:2.1">'
    +   esc_(y.sutra) + '</div>'
    + '<div style="font-size:12.5px;color:#8b8271;text-align:right;margin-top:7px">'
    +   '《大佛頂如來密因修證了義諸菩薩萬行首楞嚴經》・CBETA 大正藏 T0945・卷'
    +   (y.n === 25 ? '六' : '五') + '</div>'

    + h2('其 人 其 事')
    + '<p style="margin:0;color:#5d5648;line-height:2">' + esc_(y.story) + '</p>'

    + h2('與 此 門 相 契 的 掌 相')
    + '<p style="margin:0;color:#5d5648;line-height:2">' + esc_(y.palm) + '</p>'

    + h2('文 殊 菩 薩 的 揀 選')
    + '<div style="background:#fffdf7;border:1px solid #ddd2ba;border-radius:3px;padding:14px 16px">'
    +   '<div style="color:#33405e;font-weight:bold;line-height:2.05;letter-spacing:.06em">' + esc_(y.manju) + '</div>'
    +   '<div style="margin-top:10px;padding-top:10px;border-top:1px dashed #ddd2ba;color:#5d5648;'
    +     'font-size:15px;line-height:1.9">' + esc_(y.manjuNote) + '</div></div>'

    + h2('三 學 功 課 ． 教 理 ． 福 德 ． 禪 定')
    + three('j', '教理', '#33405e', y.practice.jiao)
    + three('f', '福德', '#9a7b3f', y.practice.fude)
    + three('c', '禪定', '#3f6b4a', y.practice.chan)
    + '<p style="font-size:13.5px;color:#8b8271;margin:8px 0 0;line-height:1.85">'
    +   '三者並行，不可偏廢：教理明其所以然，福德厚其資糧，禪定得其受用。闕一則久而生偏。</p>'

    + h2('日 用 寄 語')
    + '<div style="background:#33405e;color:#f0ece2;border-radius:3px;padding:14px 18px;line-height:1.95">'
    +   esc_(y.daily) + '</div>'

    + h2('見 輝 法 師 開 示')
    + '<a href="' + esc_(y.talk.url) + '" style="display:block;text-decoration:none;color:#241f18;'
    +   'border:1px solid #ddd2ba;border-radius:3px;padding:13px 15px;background:#fff">'
    +   '<div style="font-size:15px;line-height:1.75">' + esc_(y.talk.title) + '</div>'
    +   '<div style="font-size:12.5px;color:#8b8271;margin-top:4px">'
    +     '見輝法師《秒懂楞嚴》第 ' + y.talk.ep + ' 集　·　YouTube</div></a>'

    + (others.length ? h2('旁 通 二 門') + others.map(function (x) {
        return '<div style="border:1px solid #ddd2ba;border-radius:3px;padding:12px 14px;margin-bottom:8px;background:#fff">'
          + '<span style="font-size:12.5px;color:#8b8271">第 ' + x.n + ' 門　</span>'
          + '<b>' + x.icon + ' ' + esc_(x.short) + '</b>'
          + '<span style="color:#9a7b3f">　' + esc_(x.gate) + '　' + esc_(x.seal) + '</span></div>';
      }).join("") : '')

    + h2('同 歸 耳 根')
    + '<p style="margin:0;color:#5d5648;line-height:2">'
    +   '二十五門之中，文殊菩薩為末法眾生獨選耳根一門：「此方真教體，清淨在音聞；欲取三摩提，實以聞中入。」'
    +   '故所請之門是入手之處，而<b style="color:#241f18">反聞聞自性</b>，是諸門之後的同一條路。</p>'

    + '<div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd2ba;'
    +   'font-size:12.5px;color:#8b8271;line-height:1.95;text-align:center">'
    +   '經文出處：CBETA 大正藏 T0945《大佛頂首楞嚴經》卷五、卷六<br>'
    +   '開示出處：見輝法師《秒懂楞嚴》（見輝法師閱藏居）<br>'
    +   '白話說明與三學功課為寶嚴禪寺依古德註疏所作之方便語，非經文。<br>'
    +   '掌相八觀僅供認識自己之用，不涉吉凶禍福。<br><br>'
    +   '<a href="' + CFG.SITE + '" style="color:#9a7b3f">' + CFG.SITE + '</a><br>'
    +   '© 寶嚴山寶嚴禪寺　Baoyan Chan Monastery</div>'

    + '</div></div>';

  const text =
      '寶嚴禪寺 · 楞嚴二十五圓通．掌紋觀照\n\n'
    + req.name + ' 菩薩：\n\n'
    + '【掌相八觀】\n'
    + PALM_KEYS.map(function (k) {
        return '  ' + PALM_META[k].label + '：' + (req.feats[k] >= 50 ? PALM_META[k].hi : PALM_META[k].lo);
      }).join('\n')
    + '\n\n【所請之圓通】第 ' + y.n + ' 門　' + y.name + '　' + y.gate + '（' + y.seal + '）\n'
    + (req.times > 1 ? '  ※ 第 ' + req.times + ' 次觀照，掌相與前次相近，仍得此門。\n' : '')
    + '\n【經文．聖者自陳】\n' + y.sutra
    + '\n（CBETA 大正藏 T0945．卷' + (y.n === 25 ? '六' : '五') + '）\n'
    + '\n【其人其事】\n' + y.story + '\n'
    + '\n【文殊菩薩的揀選】\n' + y.manju + '\n' + y.manjuNote + '\n'
    + '\n【三學功課】\n  教理：' + y.practice.jiao + '\n  福德：' + y.practice.fude
    + '\n  禪定：' + y.practice.chan + '\n'
    + '\n【日用寄語】\n' + y.daily + '\n'
    + '\n【見輝法師開示】\n' + y.talk.title + '\n' + y.talk.url + '\n'
    + '\n' + CFG.SITE + '\n© 寶嚴山寶嚴禪寺';

  return {
    subject: '【寶嚴禪寺】您的楞嚴圓通．第 ' + y.n + ' 門　' + y.name + '　' + y.gate,
    html: html,
    text: text
  };
}
