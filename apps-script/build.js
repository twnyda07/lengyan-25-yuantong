/* 把網站的 yuantong-data.js 打包成 Apps Script 的 Data.gs，
   確保網頁與信件永遠用同一份資料。
   用法：node apps-script/build.js            （於專案根目錄執行） */
const fs = require("fs"), path = require("path");

const root = path.join(__dirname, "..");
const src  = fs.readFileSync(path.join(root, "yuantong-data.js"), "utf8");

const body = src
  .replace(/\nif \(typeof module[\s\S]*$/, "\n")        // 去掉 module.exports
  .trim();

const out =
`/* ===========================================================================
   自動產生，請勿直接修改。
   來源：yuantong-data.js　　產生方式：node apps-script/build.js
   =========================================================================== */

${body}
`;

fs.writeFileSync(path.join(__dirname, "Data.gs"), out);
console.log("已產生 Data.gs（" + out.length + " 字元）");
