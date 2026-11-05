const fs=require('fs');const path=require('path');
const SRC='C:/Users/User/Desktop/All Project/MQ-Coach-App/server/index.js';
const OUT=path.join(__dirname,'../lib/legacyMount.js');
const src=fs.readFileSync(SRC,'utf8');
const lines=src.split('\n');

const ALLOW=[
  /^\/api\/login$/, /^\/api\/refresh$/, /^\/api\/logout$/,
  /^\/api\/dashboard\/(stats|highlights|events|content-feed)$/,
  /^\/api\/schools(\/:id)?$/,
  /^\/api\/school-gallery\/:id$/,
  /^\/api\/school-achievements(\/feed|\/saved|\/:id\/(like|save|comments))?$/,
  /^\/api\/curriculum\/(my-assignments|my-modules|my-lp-summary)\/:userId$/,
  /^\/api\/curriculum\/(school-sports|sport-lesson-plans|grade-level-map|check-done|lesson-history)$/,
  /^\/api\/curriculum\/(sdp|msfc)\/(sports|grades\/:sport|sport-lesson-plans)$/,
  /^\/api\/curriculum\/(save-lp-status|save-extra-activity|report-filters\/:schoolId|report-data|publish-report)$/,
  /^\/api\/support\/(feedback|ticket)$/,
  /^\/api\/students(\/:id|\/standards|\/divisions)?$/,
  /^\/api\/(teams|sports-teams)(\/:id(\/players(\/:studentId)?|\/attach-players|\/attendance(-summary)?)?)?$/,
  /^\/api\/sports-teams\/attendance-status$/,
  /^\/api\/school-students$/, /^\/api\/current-date$/,
  /^\/api\/management\/(lecture-metadata|lectures)$/,
  /^\/api\/student-attendance(\/upload)?$/,
  /^\/api\/fill-marks\/(filters|format\/:id|students|template|scan|save)$/,
  /^\/api\/exam-formats$/,
  /^\/api\/reports\/(students|check|data\/:result_id|generate-pdf|download-single\/:result_id|download-zip|detail-pdf\/:result_id|fitness-data\/:result_id)$/,
];
function allowed(p){return ALLOW.some(re=>re.test(String(p||'').split('?')[0]));}
function extractCall(src,i){let j=src.indexOf('(',i);if(j<0)return null;let depth=0,inS=null,esc=false;for(let k=j;k<src.length;k++){const ch=src[k];if(inS){if(esc){esc=false;continue;}if(ch==='\\'){esc=true;continue;}if(ch===inS)inS=null;continue;}if(ch==="'"||ch==='"'||ch==='`'){inS=ch;continue;}if(ch==='/'&&src[k+1]==='/'){while(k<src.length&&src[k]!=='\n')k++;continue;}if(ch==='/'&&src[k+1]==='*'){k+=2;while(k<src.length-1&&!(src[k]==='*'&&src[k+1]==='/'))k++;k++;continue;}if(ch==='(')depth++;else if(ch===')'){depth--;if(depth===0){let end=k+1;if(src[end]===';')end++;return {text:src.slice(i,end),end};}}}return null;}

// Cut socket.io block: from "const server = require(\"http\")" to just before "const storage = multer" / "app.use(\"/uploads\""
const sockStart=src.indexOf('const server = require("http").createServer(app)');
const sockStart2=src.indexOf("const server = require('http').createServer(app)");
const s0=sockStart>=0?sockStart:sockStart2;
const multerAnchor=src.indexOf('const storage = multer.diskStorage');
if(s0<0||multerAnchor<0) throw new Error('anchors not found '+s0+' '+multerAnchor);
let body=src.slice(0,s0)+'\n/* socket.io omitted */\n'+src.slice(multerAnchor);

// Strip disallowed routes from the end-body portion only (char offsets relative to body)
const routeRe=/app\.(get|post|put|delete|all)\(/g; const kills=[]; let m;
while((m=routeRe.exec(body))){
  const got=extractCall(body,m.index); if(!got) continue;
  const pm=got.text.match(/app\.(get|post|put|delete|all)\(\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/);
  if(!pm) continue;
  const p=pm[2]||pm[3]||pm[4];
  const keep=allowed(p)||String(p).includes('attach-players')||String(p).includes('players/:studentId')||String(p).includes('${base}');
  if(!keep) kills.push({index:m.index,end:got.end,path:p});
}
kills.sort((a,b)=>b.index-a.index);
for(const k of kills) body=body.slice(0,k.index)+'\n; // stripped '+k.path+'\n'+body.slice(k.end);

body=body.replace(/if \(require\.main === module\) \{[\s\S]*$/m,'');
body=body.replace(/module\.exports = \{[\s\S]*$/m,'');
body=body.replace(/const express = require\(["']express["']\);?/,'');
body=body.replace(/const app = express\(\);?/,'');
body=body.replace(/const cors = require\(["']cors["']\);?/,'');
body=body.replace(/app\.use\(cors\([\s\S]*?\);?/g,'');
body=body.replace(/const morgan = require\(["']morgan["']\);?/,'');
body=body.replace(/app\.use\(morgan\([\s\S]*?\);?/g,'');
body=body.replace(/app\.use\(express\.json\([\s\S]*?\);?/g,'');
body=body.replace(/app\.use\(express\.urlencoded\([\s\S]*?\);?/g,'');
body=body.replace(/app\.use\(["']\/uploads["'][\s\S]*?\);?/g,'');
body=body.replace(/app\.use\(["']\/files["'][\s\S]*?\);?/g,'');
body=body.replace(/require\(["']dotenv["']\)\.config\(\);?/,'');
body=body.replace(/path\.join\(__dirname,\s*["']uploads["']\)/g,'UPLOADS_DIR');
body=body.replace(/const dir = path\.join\(__dirname, "uploads"\);/g,'const dir = UPLOADS_DIR;');
body=body.replace(/path\.join\(__dirname,\s*["']migrations["']/g, "path.join(__dirname, '..', 'migrations'");
body=body.replace(/path\.join\(__dirname,\s*["']temp["']/g, "path.join(__dirname, '..', 'tmp'");
body=body.replace(/const admin = require\(["']firebase-admin["']\);?/g, "const admin = { initializeApp(){}, credential:{ cert(){return null;} }, messaging:{ send(){return Promise.resolve();} } };");
body=body.replace(/path\.join\(__dirname, ["']serviceAccountKey\.json["']\)/g, "path.join(__dirname, '..', 'serviceAccountKey.json')");

body=body.replace(/const PDF_TEMP_DIR = [^;]+;/g,'/* PDF_TEMP_DIR from ctx */');
body=body.replace(/let PDF_TEMP_DIR = [^;]+;/g,'/* PDF_TEMP_DIR from ctx */');
body=body.replace(/require\((["'])\.\/db\1\)/g, "require('../db')");
body=body.replace(/require\((["'])\.\/services\/([^"']+)\1\)/g, "require('../services/$2')");
body=body.replace(/require\((["'])\.\/curriculumLevelResolver\1\)/g, "require('../curriculumLevelResolver')");
body=body.replace(/require\((["'])\.\/curriculumConfig\1\)/g, "require('../curriculumConfig')");
body=body.replace(/require\((["'])\.\/curriculumService\1\)/g, "require('../curriculumService')");
body=body.replace(/require\((["'])\.\/curriculumReportPdf\1\)/g, "require('../curriculumReportPdf')");
body=body.replace(/require\((["'])\.\/emailService\1\)/g, "require('../emailService')");
body=body.replace(/require\((["'])\.\/googleCloudService\1\)/g, "require('../googleCloudService')");
body=body.replace(/require\((["'])\.\/ssgmCredentialService\1\)/g, "require('../ssgmCredentialService')");
body=body.replace(/require\((["'])\.\/ssgmPreWeeklyPlannerService\1\)/g, "require('../ssgmPreWeeklyPlannerService')");
body=body.replace(/require\((["'])\.\/visitPlannerService\1\)/g, "require('../visitPlannerService')");

const header=`/**
 * AUTO-GENERATED from MQ-Coach-App/server/index.js
 * Regenerate: node tools/build_legacy.js
 */
module.exports = function mountLegacy(app, ctx) {
  var UPLOADS_DIR = ctx.UPLOADS_DIR;
  var PDF_TEMP_DIR = ctx.PDF_TEMP_DIR;
  process.env.PDF_TEMP_DIR = PDF_TEMP_DIR;
`;
fs.writeFileSync(OUT, header+body+'\n  try { require("fs").mkdirSync(PDF_TEMP_DIR,{recursive:true}); } catch {}\n};\n');
console.log('wrote',OUT,fs.statSync(OUT).size,'stripped',kills.length);
