// Export the Dev HomeCards.tsx guide illustrations as shared native assets.
// Coordinates follow FirstResumeArt, TargetArt and PluginArt; not account data.
import {createRequire} from 'node:module';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFileSync} from 'node:fs';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require=createRequire(resolve(root,'apps/web/package.json'));
const {chromium}=require('playwright-core');
const rect=(x,y,w,h,fill='#fff',rx=3,stroke='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${stroke?`stroke="${stroke}"`:''}/>`;
const text=(x,y,t,color='#55554f',size=10)=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-family="PingFang SC,Microsoft YaHei,sans-serif">${t}</text>`;
const paper=rect(68,8,74,96,'#fff',4,'#e4e4e0')+rect(77,18,28,5,'#17191c')+[26,50,74].map(y=>`<rect x="77" y="${8+y}" width="56" height="16" rx="3" fill="none" stroke="#e9e9e5" stroke-dasharray="3"/>`).join('')+
 [[22,26,-4,'教育'],[150,52,3,'项目'],[28,76,2,'技能']].map(([x,y,r,t])=>`<g transform="rotate(${r},${x},${y})">${rect(x,y,38,22,'#fff',4,'#e4e4e0')}${text(x+9,y+15,t)}</g>`).join('');
const target=[[16,22,58,'后端开发',true],[78,22,40,'Java',true],[123,22,64,'基础架构',true],[16,52,38,'北京',false],[58,52,68,'2026 校招',false]].map(([x,y,w,t,strong])=>rect(x,y,w,22,strong?'#17191c':'#fff',5,strong?'':'#e4e4e0')+text(x+8,y+15,t,strong?'#fff':'#55554f')).join('');
const plugin=rect(18,14,175,86,'#fff',6,'#e4e4e0')+rect(18,14,175,14,'#f4f4f2',0)+[7,15,23].map(x=>`<circle cx="${18+x+2.5}" cy="21.5" r="2.5" fill="#dcdcd8"/>`).join('')+rect(28,38,60,5,'#17191c')+rect(28,48,90,3,'#dcdcd8')+[60,68].map(y=>rect(28,y,110,3,'#ececea')).join('')+rect(28,76,70,3,'#ececea')+rect(107,74,76,20,'#eef6f0',5)+text(115,88,'收藏到简历','#4d9a5b');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:211,height:112},deviceScaleFactor:2});
 for(const [key,body] of Object.entries({firstResume:paper,target,plugin})) {
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="211" height="112"><defs><pattern id="dots" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.5" fill="#dcdcd8"/></pattern></defs><rect width="211" height="112" fill="#fcfcfc"/><rect width="211" height="112" fill="url(#dots)"/>${body}</svg>`;
  writeFileSync(resolve(root,'apps/native/shared/home',`${key}.svg`),svg);
  await page.setContent(`<style>body{margin:0}</style>${svg}`);
  await page.screenshot({path:resolve(root,'apps/native/shared/home',`${key}.png`)});
 }
} finally {await browser.close();}
