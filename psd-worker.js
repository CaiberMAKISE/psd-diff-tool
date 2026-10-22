 'use strict';
let ready=false,psdDoc=null,docInfo=null;
const cdn='https://cdn.jsdelivr.net/npm/ag-psd@31.0.3/dist/bundle.js';
function init(){if(ready)return;importScripts(cdn);if(typeof agPsd==='undefined')throw Error('ag-psd の読み込みに失敗しました');agPsd.initializeCanvas((w,h)=>new OffscreenCanvas(w,h));ready=true;}
const blendMap={normal:'source-over',multiply:'multiply',screen:'screen',overlay:'overlay',darken:'darken',lighten:'lighten',colorDodge:'color-dodge',colorBurn:'color-burn',hardLight:'hard-light',softLight:'soft-light',difference:'difference',exclusion:'exclusion',hue:'hue',saturation:'saturation',color:'color',luminosity:'luminosity',passThrough:'source-over',linearDodge:'lighter'};
function isGroup(n){return Array.isArray(n.children)}
function normalize(nodes,prefix='r'){return(nodes||[]).map((l,i)=>{const id=prefix+'/'+i;return {id,name:String(l.name??''),type:isGroup(l)?'group':'layer',visible:l.hidden!==true,blendMode:l.blendMode||'normal',opacity:l.opacity??255,clipping:!!l.clipping,hasMask:!!(l.mask||l.realMask),hasEffects:!!l.effects,children:isGroup(l)?normalize(l.children,id):undefined}})}
function makeCanvas(w,h){const c=new OffscreenCanvas(w,h);return c}
function render(){if(!psdDoc)throw Error('PSDが読み込まれていません');const {width:w,height:h}=psdDoc,c=makeCanvas(w,h),ctx=c.getContext('2d',{willReadFrequently:true});const warnings=new Set();let drawn=0,missing=0;
  // PSD nodes are stored top-first. Render from bottom to top, preserving order.
  function nodesDraw(nodes,target){for(const l of [...(nodes||[])].reverse())draw(l,target)}
  function draw(l,target){if(l.hidden)return;let mode=l.blendMode||'normal';if(isGroup(l)){
      const pass=mode==='passThrough';if(pass){if((l.opacity??1)!==1&&(l.opacity??255)!==255||l.mask||l.realMask)warnings.add('通過グループの不透明度・マスクは未再現: '+(l.name||'(無名)'));nodesDraw(l.children,target);return}
      const tmp=makeCanvas(w,h),tmpctx=tmp.getContext('2d');nodesDraw(l.children,tmpctx);applyComposite(target,tmp,0,0,l,mode);return;
    }
    if(l.clipping)warnings.add('クリッピング未再現: '+(l.name||'(無名)'));
    if(l.mask||l.realMask)warnings.add('レイヤーマスク未再現: '+(l.name||'(無名)'));
    if(l.effects)warnings.add('レイヤー効果未再現: '+(l.name||'(無名)'));
    const img=l.canvas||l.imageData;if(!img){missing++;return}
    if(l.canvas){applyComposite(target,l.canvas,l.left||0,l.top||0,l,mode);drawn++;}
    else {warnings.add('画像データ形式が未対応: '+(l.name||'(無名)'));missing++;}
  }
  function applyComposite(target,src,x,y,l,mode){target.save();target.globalAlpha=Math.min(1,Math.max(0,(l.opacity??1)>1?(l.opacity/255):(l.opacity??1))); const composite=blendMap[mode];if(!composite){warnings.add('未対応合成モード '+mode+' : '+(l.name||'(無名)'));target.globalCompositeOperation='source-over'}else target.globalCompositeOperation=composite;target.drawImage(src,x,y);target.restore()}
  nodesDraw(psdDoc.children,ctx);
  const output=ctx.getImageData(0,0,w,h);let comparison=null;
  if(psdDoc.canvas){const refctx=makeCanvas(w,h).getContext('2d',{willReadFrequently:true});refctx.drawImage(psdDoc.canvas,0,0);const ref=refctx.getImageData(0,0,w,h).data;let errorPixels=0,totalAbs=0,maxError=0;const diff=makeCanvas(w,h),dctx=diff.getContext('2d'),d=dctx.createImageData(w,h);
    for(let i=0;i<ref.length;i+=4){let local=0;for(let j=0;j<4;j++){const delta=Math.abs(ref[i+j]-output.data[i+j]);totalAbs+=delta;local=Math.max(local,delta);maxError=Math.max(maxError,delta);}if(local>0)errorPixels++;d.data[i]=Math.min(255,Math.abs(ref[i]-output.data[i])*4);d.data[i+1]=Math.min(255,Math.abs(ref[i+1]-output.data[i+1])*4);d.data[i+2]=Math.min(255,Math.abs(ref[i+2]-output.data[i+2])*4);d.data[i+3]=255;}
    dctx.putImageData(d,0,0);comparison={differencePixels:errorPixels,totalPixels:w*h,meanAbsError:totalAbs/(w*h*4),maxError,diffBitmap:diff.transferToImageBitmap()};
  }
  return {bitmap:c.transferToImageBitmap(),comparison,warnings:[...warnings].slice(0,150),drawn,missing};
}
self.onmessage=e=>{const m=e.data;try{if(m?.type==='parse'){init();psdDoc=null;const psd=agPsd.readPsd(m.buffer,{skipLayerImageData:false,skipThumbnail:true,skipLinkedFilesData:true,skipCompositeImageData:false,logMissingFeatures:false});if(psd.width>10000||psd.height>10000||psd.width*psd.height>25000000)throw Error('キャンバスが大きすぎます');psdDoc=psd;docInfo={filename:m.filename,width:psd.width,height:psd.height,colorMode:psd.colorMode,version:psd.version,nodes:normalize(psd.children)};const ref=psd.canvas?psd.canvas.transferToImageBitmap():null;self.postMessage({type:'result',report:docInfo,bitmap:ref},ref?[ref]:[])}else if(m?.type==='render'){const r=render();const transfer=[r.bitmap];if(r.comparison?.diffBitmap)transfer.push(r.comparison.diffBitmap);self.postMessage({type:'rendered',...r},transfer)}}catch(err){self.postMessage({type:'error',operation:m?.type,error:String(err?.stack||err)})}};
