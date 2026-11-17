const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(root,'welearn-auto.user.js'),'utf8');
const html=fs.readFileSync(path.join(root,'demo/index.html'),'utf8');
function fixture(n=0){
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://centercourseware.sflep.com/local-demo.html'});
  const source=dom.window.document.querySelector('script:not([src])').textContent;
  dom.window.eval(source);dom.window.eval('mount('+n+')');dom.window.eval(script);return dom;
}
for(const [n,count] of [[0,3],[1,1],[2,1]])test('fills simulated task '+n,()=>{
  const dom=fixture(n);try{dom.window.document.querySelector('#welearn-auto-fill').click();assert.ok(dom.window.document.querySelector('#welearn-auto-status').textContent.includes(`${count}/${count}`));}finally{dom.window.close();}
});
test('submits and recognizes the hidden et-button wrapper',async()=>{
  const dom=fixture();try{
    dom.window.document.querySelector('#welearn-auto-submit').click();await new Promise(r=>setTimeout(r,800));
    assert.equal(dom.window.document.querySelector('#submit-wrap').classList.contains('ng-hide'),true);
    assert.ok(dom.window.document.querySelector('#welearn-auto-status').textContent.includes('等待目录核验'));
  }finally{dom.window.close();}
});
test('published text contains no local account or machine details',()=>{
  for(const file of ['welearn-auto.user.js','README.md','demo/index.html','package.json']){
    const content=fs.readFileSync(path.join(root,file),'utf8');
    assert.doesNotMatch(content,/Lenovo|788563|@qq\.com|C:\\Users\\|AppData|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+/i,file);
  }
  assert.doesNotMatch(script,/@author\s+\S+/);
});
