import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
const base=process.env.RELEASE_BASE_URL||'https://sanadapp.pro';
const accounts=JSON.parse(readFileSync(process.env.RELEASE_TEST_ACCOUNTS||'/tmp/sanad-test-accounts.json','utf8'));
assert.ok(accounts.length === 2 && accounts.every(a => a.email.endsWith('@example.invalid')), 'Use two disposable synthetic accounts only');
const results=[];
async function check(name,fn){try{await fn();results.push({name,status:'PASS'});console.log('PASS '+name)}catch(e){results.push({name,status:'FAIL',detail:e.message});console.log('FAIL '+name+': '+e.message)}}
async function call(path,{token,body,method=body?'POST':'GET',headers={}}={}){const res=await fetch(base+path,{method,redirect:'manual',headers:{...(body?{'Content-Type':'application/json',Origin:base}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)}); const text=await res.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:res.status,headers:res.headers,data};}
await check('Homepage and privacy available',async()=>{for(const path of ['/','/privacy.html','/auth/callback'])assert.equal((await call(path)).status,200)});
await check('Anonymous access denied',async()=>{for(const path of ['/api/auth/me','/api/workspace'])assert.equal((await call(path)).status,401)});
await check('Foreign origin rejected',async()=>assert.equal((await call('/api/auth/refresh',{body:{},headers:{Origin:'https://external.invalid'}})).status,403));
await check('GET cannot clear workspace',async()=>assert.equal((await call('/api/workspace/clear')).status,405));
await check('Malformed JSON rejected',async()=>{const r=await fetch(base+'/api/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:'{'});assert.equal(r.status,400)});
await check('Non JSON rejected',async()=>{const r=await fetch(base+'/api/auth/refresh',{method:'POST',headers:{Origin:base},body:'test'});assert.equal(r.status,415)});
await check('Google redirect includes correct callback and state',async()=>{const r=await call('/api/auth/google?state=release-test-state');assert.equal(r.status,302);const u=new URL(r.headers.get('location'));assert.equal(u.hostname,'accounts.google.com');assert.equal(u.searchParams.get('state'),'release-test-state');assert.equal(u.searchParams.get('redirect_uri'),base+'/auth/callback')});
const sessions=[];
for(const [i,a] of accounts.entries())await check('Password login test account '+(i+1),async()=>{const r=await call('/api/auth/sign-in',{body:{email:a.email,password:a.password}});assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.data.session?.accessToken);sessions[i]=r.data.session});
if(sessions.length===2&&sessions.every(Boolean)){
const owner=sessions[0].accessToken,member=sessions[1].accessToken;
let state;
await check('Save encrypted profile',async()=>{const r=await call('/api/workspace/profile',{token:owner,body:{profile:{trainerName:'مدرب اختبار الإصدار',collegeName:'كلية تجريبية',departmentName:'قسم تجريبي',employeeNumber:'TEST-001'}}});assert.equal(r.status,200,JSON.stringify(r.data))});
await check('Load and decrypt profile',async()=>{const r=await call('/api/workspace',{token:owner});assert.equal(r.status,200,JSON.stringify(r.data));state=r.data;assert.equal(state.trainer.name,'مدرب اختبار الإصدار')});
if(state){
const traineeId=randomUUID(),assessmentId=randomUUID();
state.course={name:'اختبار الإصدار '+Date.now(),kind:'theory',sectionNumber:'TEST',savedAt:new Date().toISOString(),updatedAt:'',code:randomUUID().replaceAll('-','').toUpperCase(),inviteCode:''};
state.trainees=[{id:traineeId,name:'متدرب اختبار',trainingNumber:'TEST-1001',theorySection:'101',practicalSection:'201'}];
state.assessments=[{id:assessmentId,name:'اختبار تجريبي',kind:'theory',category:'coursework',maxScore:20,date:'2026-10-05',weight:0}];state.grades=[{traineeId,assessmentId,score:17}];
await check('Create course, trainee, assessment and grade',async()=>{const r=await call('/api/workspace/save',{token:owner,body:{state}});assert.equal(r.status,200,JSON.stringify(r.data));const loaded=await call('/api/workspace',{token:owner});assert.equal(loaded.status,200);state=loaded.data;assert.equal(state.trainees[0].name,'متدرب اختبار');assert.equal(state.grades[0].score,17);assert.ok(state.course.inviteCode)});
await check('Other account cannot see the new course before joining',async()=>{const r=await call('/api/workspace',{token:member});assert.equal(r.status,200);assert.notEqual(r.data.course.code,state.course.code);assert.ok(!r.data.trainees.some(t=>t.id===traineeId))});
await check('Find invitation without exposing course data',async()=>{const r=await call('/api/workspace/find-course',{token:member,body:{code:state.course.inviteCode}});assert.equal(r.status,200);assert.equal(r.data?.code,state.course.inviteCode);assert.equal(r.data.name,'')});
await check('Join course and read shared grade',async()=>{const r=await call('/api/workspace/join-course',{token:member,body:{code:state.course.inviteCode,trainerName:'مدرب اختبار ثان',employeeNumber:'TEST-002'}});assert.equal(r.status,200,JSON.stringify(r.data));const loaded=await call('/api/workspace',{token:member});assert.equal(loaded.status,200);assert.equal(loaded.data.grades[0].score,17)});
await check('Member edits shared grade',async()=>{const r=await call('/api/workspace',{token:member});const memberState=r.data;memberState.grades[0].score=19;const saved=await call('/api/workspace/save',{token:member,body:{state:memberState}});assert.equal(saved.status,200,JSON.stringify(saved.data));const ownerState=await call('/api/workspace',{token:owner});assert.equal(ownerState.data.grades[0].score,19)});
await check('Stale revision does not overwrite newer data',async()=>{state.grades[0].score=5;const r=await call('/api/workspace/save',{token:owner,body:{state}});assert.notEqual(r.status,200);const loaded=await call('/api/workspace',{token:owner});assert.equal(loaded.data.grades[0].score,19)});
await check('Course list API available',async()=>{const r=await call('/api/workspace/courses',{token:owner});assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(Array.isArray(r.data))});
}
await check('Refresh rotates credentials',async()=>{const r=await call('/api/auth/refresh',{body:{refreshToken:sessions[1].refreshToken}});assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.data.session.accessToken);sessions[1]=r.data.session});
}
const browser=await chromium.launch({channel:'chrome',headless:true});
mkdirSync('/tmp/sanad-release-screenshots',{recursive:true});
try{
for(const [name,width,height] of [['mobile',390,844],['desktop',1440,900]])await check('Browser '+name+' navigation and layout',async()=>{
const context=await browser.newContext({viewport:{width,height}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(base,{waitUntil:'networkidle'});assert.equal(await page.locator('html').getAttribute('dir'),'rtl');assert.ok(await page.getByRole('button',{name:'ابدأ الآن',exact:true}).count());
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'Horizontal overflow');
await page.getByRole('button',{name:'دخول',exact:true}).first().click();await page.getByRole('button',{name:'تسجيل الدخول',exact:true}).click();await page.getByText('البريد الإلكتروني مطلوب',{exact:true}).waitFor();
await page.getByRole('button',{name:'إنشاء حساب',exact:true}).last().click();await page.getByText('إنشاء حساب جديد',{exact:true}).waitFor();
await page.screenshot({path:'/tmp/sanad-release-screenshots/'+name+'.png'});assert.deepEqual(errors,[]);await context.close();});
await check('Browser authenticated owner loads saved grades and exports Excel',async()=>{
const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(base);await page.getByRole('button',{name:'دخول',exact:true}).first().click();await page.locator('input[type=email]').fill(accounts[0].email);await page.locator('input[type=password]').fill(accounts[0].password);await page.getByRole('button',{name:'تسجيل الدخول',exact:true}).click();await page.waitForTimeout(3000);
const text=await page.locator('body').innerText();assert.ok(text.includes('متدرب اختبار'),'Saved trainee missing after login');
const btn=page.getByRole('button',{name:/تصدير/}).first();const promise=page.waitForEvent('download',{timeout:10000});await btn.click();const download=await promise;assert.ok(download.suggestedFilename().endsWith('.xlsx'));await download.saveAs('/tmp/sanad-release-screenshots/export.xlsx');assert.deepEqual(errors,[]);await page.screenshot({path:'/tmp/sanad-release-screenshots/authenticated.png'});await context.close();});
}finally{await browser.close()}
writeFileSync('/tmp/sanad-release-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length}));
process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
