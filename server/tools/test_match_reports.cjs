// Integration test against the local API. Uses the designated head-coach test fixture.
// No passwords or tokens are printed. Creates and removes only its own test rows/files.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {PDFDocument}=require('pdf-lib');
const db=require('../db');
const base='http://127.0.0.1:4000';
const created=[],ownedFiles=[];let token,refresh;let passes=0;
function check(cond,msg){assert.ok(cond,msg);console.log('PASS',msg);passes++;}
async function call(p,opts={}){const r=await fetch(base+p,{...opts,headers:{...(token?{Authorization:'Bearer '+token}:{}),...opts.headers}});const d=await r.json().catch(()=>({}));return {r,d};}
const fixture=process.env.MQ_HEADCOACH_FIXTURE||path.join(process.env.USERPROFILE,'Desktop','mq-test-headcoach-login.txt');
function form(fields,photo,pdf){const f=new FormData();for(const [k,v]of Object.entries(fields))f.append(k,Array.isArray(v)?JSON.stringify(v):String(v));if(photo)f.append('photos',new Blob([photo],{type:'image/png'}),'match-test.png');if(pdf)f.append('report',new Blob([pdf],{type:'application/pdf'}),'match-test.pdf');return f;}
(async()=>{try{
  const text=fs.readFileSync(fixture,'utf8');const email=text.match(/^Email:\s*(.+)$/mi)?.[1].trim(),password=text.match(/^Password:\s*(.+)$/mi)?.[1].trim();assert.ok(email&&password,'Test fixture malformed');
  let x=await call('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});check(x.d.success&&x.d.user.id===938&&Number(x.d.user.role_id)===4,'real login as 938 / role 4 on 4000');token=x.d.token;refresh=x.d.refresh_token;
  x=await call('/api/match-reports');check(x.r.status===200&&Array.isArray(x.d.reports),'ported match list');const baseline=x.d.reports.length;check(x.d.reports.every(r=>Number(r.school_id)===2),'938 list stays scoped to school 2');
  const options=await call('/api/match-reports/options?school_id=2');check(options.r.status===200&&Array.isArray(options.d.teams)&&Array.isArray(options.d.players),'team dropdown and player picker choices');
  x=await call('/api/match-reports/options?school_id=1&user_id=1&role_id=1');check(x.r.status===403,'query identity spoof cannot read another school');
  const team=options.d.teams[0];const player=options.d.players[0];
  const f={school_id:2,user_id:1,structured:true,match_date:'2026-11-06',sport:team?.sport||'Football',home_team_id:team?.id||'',home_team_name:team?.name||'MQ TEST HOME',away_team_id:'',away_team_name:'MQ TEST OPPONENT '+Date.now(),home_score:3,away_score:1,venue:'Integration test only',notes:'Temporary test - remove after checks',player_ids:player?[player.id]:[],retained_photos:[]};
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');
  x=await call('/api/match-reports',{method:'POST',body:form(f,png)});check(x.r.status===200&&x.d.reportId,'create scorecard with photo multipart');const id=x.d.reportId;created.push(id);
  x=await call('/api/match-reports/'+id);check(x.d.report.user_id===938&&x.d.report.result==='WIN'&&x.d.report.home_score===3,'stored score/result and authenticated author (ignores spoofed user_id)');check(x.d.report.photos.length===1&&x.d.report.players.length===(player?1:0),'photo and chosen player persisted');ownedFiles.push(x.d.report.file_path,...x.d.report.photos);const retained=x.d.report.photos;const nativeFile=await fetch(base+'/uploads/'+x.d.report.file_path);check(nativeFile.status===200,'native PDF opens from shared web file_path');
  let link=await call(`/api/match-reports/${id}/pdf-link`);let pdf=await fetch(base+link.d.path);check(pdf.status===200&&pdf.headers.get('content-type').includes('application/pdf'),'signed browser PDF link without bearer');let bytes=Buffer.from(await pdf.arrayBuffer());let doc=await PDFDocument.load(bytes);check(doc.getPageCount()>=1,'generated scorecard PDF parses');fs.writeFileSync(path.join(process.env.TEMP,'match-report-native-test.pdf'),bytes);
  x=await call(`/api/match-reports/${id}/edit`,{method:'POST',body:form({...f,home_score:2,away_score:2,retained_photos:retained})});check(x.r.status===200,'edit using XHR-compatible POST multipart');x=await call('/api/match-reports/'+id);check(x.d.report.result==='DRAW'&&x.d.report.photos.length===1,'score/result updated; photo retained');ownedFiles.push(x.d.report.file_path);
  x=await call('/api/match-reports/'+id,{method:'PUT',body:form({...f,home_score:0,away_score:2,retained_photos:retained})});check(x.r.status===200,'PUT edit compatibility');x=await call('/api/match-reports/'+id);check(x.d.report.result==='LOSS','loss badge derived correctly');ownedFiles.push(x.d.report.file_path);
  for(const [fields,label] of [[{home_score:-1},'negative score'],[{match_date:'2026-02-30'},'invalid calendar date'],[{home_team_id:2147483647},'foreign or missing team'],[{player_ids:[2147483647]},'foreign or missing player']]){x=await call('/api/match-reports',{method:'POST',body:form({...f,...fields})});check(x.r.status===400,label+' rejected');}
  x=await call('/api/match-reports',{method:'POST',body:form({...f,school_id:1})});check(x.r.status===403,'cross-school write rejected');
  x=await call('/api/match-reports',{method:'POST',body:form(f,Buffer.from('not an image'))});check(x.r.status===400,'fake photo content rejected');
  pdf=await fetch(base+`/api/match-report-pdf/${id}`);check(pdf.status===401,'PDF requires valid short-lived signature');
  let anonymous=await fetch(base+'/api/match-reports');check(anonymous.status===401,'list requires login');
  const orig=await PDFDocument.create();orig.addPage().drawText('Original web match PDF - byte identical test');const original=Buffer.from(await orig.save());
  x=await call('/api/match-reports',{method:'POST',body:form({school_id:2,match_date:'2026-11-06'},null,original)});check(x.r.status===200&&x.d.reportId,'legacy web PDF-upload flow ported');const uploadId=x.d.reportId;created.push(uploadId);x=await call('/api/match-reports/'+uploadId);ownedFiles.push(x.d.report.file_path);check(!x.d.report.structured&&x.d.report.result==='UPLOADED','legacy PDF is not misrepresented as a scored match');link=await call(`/api/match-reports/${uploadId}/pdf-link`);pdf=await fetch(base+link.d.path);bytes=Buffer.from(await pdf.arrayBuffer());check(bytes.equals(original),'web uploaded PDF served byte-for-byte unchanged');
  for(const id of created){x=await call('/api/match-reports/'+id,{method:'DELETE'});check(x.r.status===200,'delete own temporary report '+id);}
  x=await call('/api/match-reports');check(x.d.reports.length===baseline,'report count restored after tests');const [rem]=await db.query('SELECT report_id FROM app_match_report_details WHERE report_id IN (?)',[created]);check(rem.length===0,'test metadata removed');console.log('ALL CHECKS PASSED',passes);
 }finally{
  // Only IDs returned to this test run are eligible for cleanup.
  for(const id of created){await db.query('DELETE FROM app_match_report_details WHERE report_id=?',[id]);await db.query('DELETE FROM match_report_card WHERE id=? AND user_id=938',[id]);}
  for(const f of ownedFiles){if(/^match_reports\/[a-f0-9-]+\.(png|jpg|webp|pdf)$/.test(f))try{fs.unlinkSync(path.join(process.env.UPLOADS_DIR,f));}catch{}}
  if(refresh&&token)await call('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:refresh})}).catch(()=>{});
  await db.end();
 }
})().catch(e=>{console.error('TEST FAILED:',e.message);process.exitCode=1;});
