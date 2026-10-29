'use strict';
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const root=path.resolve(__dirname,'..');
  const env={...process.env,AULA_TEST:'1',AULA_TEST_PROFILE:path.join(root,'test-results/device-profile')};
  delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:path.join(root,'cache/electron/electron.exe'),args:[root],env});
  try {
    const page=await app.firstWindow();
    const errors=[], failures=[],logs=[];
    page.on('console',m=>{if(m.text().includes('Error')||m.type()==='error')logs.push(m.text());});
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.status()>=400) failures.push({url:r.url(),status:r.status()});});
    page.on('requestfailed',r=>failures.push({url:r.url(),error:r.failure()?.errorText}));
    await page.addInitScript(()=>{
      globalThis.__hidAudit={sent:{},blocked:[],received:0};
      const original=HIDDevice.prototype.sendReport;
      HIDDevice.prototype.sendReport=function(id,data){
        const bytes=new Uint8Array(data.buffer||data,data.byteOffset||0,data.byteLength);
        const command=bytes[1];
        if(bytes[0]!==170 || ![0,16,17,18,19,20,21,22,23,24,27,28].includes(command)) {
          __hidAudit.blocked.push(command); return Promise.reject(new Error('Read-only hardware check blocked '+command));
        }
        __hidAudit.sent[command]=(__hidAudit.sent[command]||0)+1;
        return original.call(this,id,data);
      };
      const originalOpen=HIDDevice.prototype.open;
      HIDDevice.prototype.open=async function(){
        this.addEventListener('inputreport',()=>__hidAudit.received++);
        return originalOpen.call(this);
      };
    });
    await app.evaluate(({session})=>{
      globalThis.hidCandidates=[];
      session.fromPartition('persist:mini68-offline').on('select-hid-device',(_e,details)=>{
        globalThis.hidCandidates=details.deviceList.map(d=>({deviceId:d.deviceId,name:d.name,vendorId:d.vendorId,productId:d.productId}));
      });
    });
    await page.waitForURL('https://mini68.local/**');
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');
    if(await page.getByText('连接键盘',{exact:true}).isVisible()) await page.getByText('连接键盘',{exact:true}).click();
    await page.waitForFunction(()=>document.body.innerText.includes('MINI68 HE MAX') && document.body.innerText.includes('宏管理器'),{},{timeout:20000}).catch(e=>{console.log('CONNECT_WAIT',e.message);process.exitCode=1;});
    console.log('DEVICE_TEXT',(await page.locator('body').innerText()).slice(0,5000));
    const audit=await page.evaluate(()=>__hidAudit);
    const candidates=await app.evaluate(()=>globalThis.hidCandidates);
    const devices=await page.evaluate(async()=> (await navigator.hid.getDevices()).map(d=>({name:d.productName,vendorId:d.vendorId,productId:d.productId,opened:d.opened,collections:d.collections.map(c=>({usagePage:c.usagePage,usage:c.usage,outputReports:c.outputReports.map(r=>({reportId:r.reportId,items:r.items.map(i=>i.reportCount)}))}))})));
    console.log('AUDIT',JSON.stringify(audit));console.log('DEVICES',JSON.stringify(devices));
    console.log('ERRORS',errors);console.log('FAILURES',failures);console.log('LOGS',logs);console.log('CANDIDATES',candidates);
    const shot=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    fs.writeFileSync(path.join(root,'test-results/device.png'),Buffer.from(shot,'base64'));
    fs.writeFileSync(path.join(root,'test-results/device.json'),JSON.stringify({audit,candidates,devices,errors,failures},null,2));
    if(errors.length||failures.length||audit.blocked.length||!audit.received)process.exitCode=1;
  } finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
