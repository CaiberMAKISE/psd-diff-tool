 'use strict';
const WORKER_VERSION='v0.4.2';
const RENDER_ENGINE_REVISION='target-layer-composite-diagnostic-1';
let ready=false,psdDoc=null,docInfo=null;
const cdn='https://cdn.jsdelivr.net/npm/ag-psd@31.0.3/dist/bundle.js';
function init(){if(ready)return;importScripts(cdn);if(typeof agPsd==='undefined')throw Error('ag-psd の読み込みに失敗しました');agPsd.initializeCanvas((w,h)=>new OffscreenCanvas(w,h));ready=true;}
const blendMap={'color dodge':'color-dodge','color burn':'color-burn','linear dodge':'lighter','linear burn':'multiply','hard light':'hard-light','soft light':'soft-light','pass through':'source-over',normal:'source-over',multiply:'multiply',screen:'screen',overlay:'overlay',darken:'darken',lighten:'lighten',colorDodge:'color-dodge',colorBurn:'color-burn',hardLight:'hard-light',softLight:'soft-light',difference:'difference',exclusion:'exclusion',hue:'hue',saturation:'saturation',color:'color',luminosity:'luminosity',passThrough:'source-over',linearDodge:'lighter'};
function isGroup(n){return Array.isArray(n.children)}
function normalize(nodes,prefix='r'){return(nodes||[]).map((l,i)=>{const id=prefix+'/'+i;return {id,name:String(l.name??''),type:isGroup(l)?'group':'layer',visible:l.hidden!==true,blendMode:l.blendMode||'normal',opacity:l.opacity??255,clipping:!!l.clipping,hasMask:!!(l.mask||l.realMask),hasEffects:!!l.effects,children:isGroup(l)?normalize(l.children,id):undefined}})}
function makeCanvas(w,h){const c=new OffscreenCanvas(w,h);return c}
function render(options={}){
 if(!psdDoc)throw Error('PSDが読み込まれていません');
 const {width:w,height:h}=psdDoc;
 const c=makeCanvas(w,h),ctx=c.getContext('2d',{willReadFrequently:true});
 const warnings=new Set(),trace=[];
 const enableMasks=options.enableMasks!==false,enableClipping=options.enableClipping!==false,enablePassThrough=options.enablePassThrough!==false;
 const counts={total:0,groups:0,hidden:0,hiddenDescendants:0,emptyImage:0,drawn:0,clipping:0,mask:0,effects:0,unsupportedBlend:0,maskApplied:0,clipApplied:0,clipOrphan:0,maskUnavailable:0,visibleMaskCandidates:0,visibleClipCandidates:0,passThroughDirect:0,passThroughFallback:0};
 let layerOrdinal=0;
 const alpha=(v)=>Math.min(1,Math.max(0,(v??1)>1?v/255:v));
 function put(target,src,x,y,l,mode){target.save();target.globalAlpha=alpha(l.opacity);const key=blendMap[String(mode).trim()]||blendMap[String(mode).replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase()];if(!key){warnings.add('未対応合成モード '+mode+' : '+(l.name||'(無名)'));target.globalCompositeOperation='source-over'}else target.globalCompositeOperation=key;target.drawImage(src,x,y);target.restore()}
 function extractMask(mask,layer){
   if(!mask||mask.disabled)return null;
   if(!mask.canvas){counts.maskUnavailable++;return null}
   const maskCanvas=mask.canvas,mc=maskCanvas.getContext('2d',{willReadFrequently:true});
   const src=mc.getImageData(0,0,maskCanvas.width,maskCanvas.height).data;
   const coverage=new Uint8Array(w*h);coverage.fill(mask.defaultColor??255);
   const x0=(mask.left||0)+(mask.positionRelativeToLayer?(layer.left||0):0);
   const y0=(mask.top||0)+(mask.positionRelativeToLayer?(layer.top||0):0);
   const density=mask.userMaskDensity??1;
   for(let sy=0;sy<maskCanvas.height;sy++){const yy=sy+y0;if(yy<0||yy>=h)continue;for(let sx=0;sx<maskCanvas.width;sx++){
      const xx=sx+x0;if(xx<0||xx>=w)continue;const i=(sy*maskCanvas.width+sx)*4;
      // ag-psd decodes bitmap masks as grayscale canvas pixels.
      const a=src[i+3]/255;const gray=src[i];const v=(gray*a+(mask.defaultColor??255)*(1-a));coverage[yy*w+xx]=Math.round(255-(255-v)*density);
   }}
   return coverage;
 }
 function maskedSource(layer,path){
   const source=layer.canvas;
   if(!source)return null;
   if(!enableMasks||!layer.mask||layer.mask.disabled)return {canvas:source,x:layer.left||0,y:layer.top||0};
   const coverage=extractMask(layer.mask,layer);
   if(!coverage){warnings.add('マスク画像を取得できません: '+path);return {canvas:source,x:layer.left||0,y:layer.top||0}}
   const tmp=makeCanvas(w,h),t=tmp.getContext('2d',{willReadFrequently:true});t.drawImage(source,layer.left||0,layer.top||0);
   const id=t.getImageData(0,0,w,h);for(let i=0,j=0;i<id.data.length;i+=4,j++)id.data[i+3]=Math.round(id.data[i+3]*coverage[j]/255);
   t.putImageData(id,0,0);counts.maskApplied++;
   if(layer.realMask||layer.vectorMask)warnings.add('追加マスク（real/vector）の正確な再現は未対応: '+path);
   return {canvas:tmp,x:0,y:0};
 }
 function alphaFromCanvas(canvas){const data=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;const a=new Uint8Array(w*h);for(let j=0,i=3;j<a.length;j++,i+=4)a[j]=data[i];return a}
 function constrainAlpha(canvas,mask){const t=canvas.getContext('2d',{willReadFrequently:true}),id=t.getImageData(0,0,w,h);for(let i=3,j=0;i<id.data.length;i+=4,j++)id.data[i]=Math.round(id.data[i]*mask[j]/255);t.putImageData(id,0,0)}
 function nodesDraw(nodes,target,parentPath='',ancestorHidden=false,prefix='r'){
   // Verified against ember_ic and wisleah_ic: draw children in array order.
   // Never reverse here unless explicitly requested for diagnostics.
   const ordered=options.reverseOrder?[...(nodes||[])].reverse():[...(nodes||[])];
   let baseAlpha=null;
   for(const l of ordered){
     const nodeIndex=(nodes||[]).indexOf(l),nodeId=prefix+'/'+nodeIndex;
     const path=parentPath+'/'+(l.name||'(無名)'),g=isGroup(l),isHidden=l.hidden===true,mode=l.blendMode||'normal';
     const entry={path,name:l.name||'',type:g?'group':'layer',originalHidden:isHidden,ancestorHidden,hasCanvas:!!l.canvas,hasImageData:!!l.imageData,blendMode:mode,opacity:l.opacity??null,clipping:!!l.clipping,mask:!!(l.mask||l.realMask),effects:!!l.effects,bounds:{left:l.left??null,top:l.top??null,right:l.right??null,bottom:l.bottom??null},canvasSize:l.canvas?{width:l.canvas.width,height:l.canvas.height}:null,reason:'',rendered:false,drawOrder:null,maskApplied:false,clipApplied:false};
     trace.push(entry);counts.total++;if(g)counts.groups++;if(l.clipping)counts.clipping++;if(l.mask||l.realMask)counts.mask++;if(l.effects)counts.effects++;if(!blendMap[mode])counts.unsupportedBlend++;if(isHidden)counts.hidden++;if(ancestorHidden)counts.hiddenDescendants++;
     const hasVisibilityMap=!!options.visibilityMap;
     const onlyId=options.debugOnlyLayerId;
     const relevant=!onlyId||nodeId===onlyId||(g&&onlyId.startsWith(nodeId+'/'));
     if(!relevant||options.debugSkipLayerId===nodeId){entry.reason=!relevant?'diagnostic-other-layer':'diagnostic-skipped';if(!l.clipping)baseAlpha=null;continue}
     const blocked=onlyId?false:(hasVisibilityMap?!options.visibilityMap[nodeId]:((ancestorHidden||isHidden)&&!options.forceVisible));
     if(blocked){entry.reason=ancestorHidden?'ancestor-hidden':'self-hidden';if(g)nodesDraw(l.children,target,path,hasVisibilityMap?false:true,nodeId);if(!l.clipping)baseAlpha=null;continue}
     if(l.mask && !l.mask.disabled)counts.visibleMaskCandidates++;
     if(l.clipping)counts.visibleClipCandidates++;
     let src=null;
     if(g && (mode==='pass through'||mode==='passThrough') && enablePassThrough && alpha(l.opacity)===1 && !l.mask && !l.realMask && !l.vectorMask && !l.clipping){
       // A pass-through group with no group-local restrictions acts as a transparent
       // structural container. Draw children into the actual backdrop, so multiply,
       // color-dodge, etc. see pixels underneath the group.
       nodesDraw(l.children,target,path,false,nodeId);
       counts.passThroughDirect++;
       entry.reason='pass-through-direct';
       // Clipping across group boundaries is not modeled yet.
       baseAlpha=null;
       continue;
     }
     if(g){entry.reason='group';
       const groupBuffer=makeCanvas(w,h),groupCtx=groupBuffer.getContext('2d',{willReadFrequently:true});
       nodesDraw(l.children,groupCtx,path,false,nodeId);
       if(mode==='passThrough'||mode==='pass through'){
         if(enablePassThrough){counts.passThroughFallback++;warnings.add('通過グループに不透明度・マスク・クリッピング等があるため隔離合成で代用: '+path)}
         else warnings.add('通過グループを隔離合成（比較用）: '+path);
       }
       src={canvas:groupBuffer,x:0,y:0};
       if(enableMasks&&l.mask&&!l.mask.disabled){const mask=extractMask(l.mask,l);if(mask){constrainAlpha(groupBuffer,mask);counts.maskApplied++;entry.maskApplied=true}else warnings.add('グループマスク未取得: '+path)}
     }else{
       src=maskedSource(l,path);if(!src){counts.emptyImage++;entry.reason='no-image';if(!l.clipping)baseAlpha=null;continue}
       entry.maskApplied=enableMasks&&!!l.mask&&!l.mask.disabled&&!!l.mask.canvas;
       if(l.realMask||l.vectorMask)warnings.add('追加マスクに未対応: '+path);
     }
     if(l.effects)warnings.add('レイヤー効果未対応: '+path);
     // Construct a standalone source canvas so the alpha of the base layer can be
     // used by clipping layers without clipping against the accumulated image.
     const standalone=makeCanvas(w,h),st=standalone.getContext('2d');st.drawImage(src.canvas,src.x,src.y);
     if(l.clipping&&enableClipping){
       if(baseAlpha){constrainAlpha(standalone,baseAlpha);counts.clipApplied++;entry.clipApplied=true}
       else{counts.clipOrphan++;warnings.add('クリッピング基準レイヤーを特定できません: '+path)}
     }else if(l.clipping){warnings.add('クリッピング無効（比較用）: '+path)}
     if(!l.clipping)baseAlpha=alphaFromCanvas(standalone);
     // Do not double-apply the opacity of groups inside layer buffers.
     put(target,standalone,0,0,l,options.debugNormalBlendId===nodeId?'normal':((mode==='passThrough'||mode==='pass through')?'normal':mode));
     if(!g){entry.drawOrder=++layerOrdinal;entry.rendered=true;entry.reason='drawn';counts.drawn++}
   }
 }
 nodesDraw(psdDoc.children,ctx);
 const output=ctx.getImageData(0,0,w,h);let comparison=null;
 if(psdDoc.canvas){const rc=makeCanvas(w,h),refctx=rc.getContext('2d',{willReadFrequently:true});refctx.drawImage(psdDoc.canvas,0,0);const ref=refctx.getImageData(0,0,w,h).data;let errorPixels=0,totalAbs=0,maxError=0,visibleMismatch=0,alphaAbs=0,compositedRGBAbs=0;
 const tileSize=30, cols=Math.ceil(w/tileSize), rows=Math.ceil(h/tileSize);
 const tiles=Array.from({length:cols*rows},(_,i)=>({x:(i%cols)*tileSize,y:Math.floor(i/cols)*tileSize,width:Math.min(tileSize,w-(i%cols)*tileSize),height:Math.min(tileSize,h-Math.floor(i/cols)*tileSize),absoluteError:0,pixelsOver2:0,pixelsOver16:0,maxError:0}));
 const thresholds={over0:0,over2:0,over8:0,over16:0,over32:0,over64:0,over128:0};
 let largestError={x:0,y:0,value:0},weightedErrorTotal=0;
const diff=makeCanvas(w,h),dctx=diff.getContext('2d'),d=dctx.createImageData(w,h);
 for(let i=0;i<ref.length;i+=4){let local=0;for(let j=0;j<4;j++){const delta=Math.abs(ref[i+j]-output.data[i+j]);totalAbs+=delta;local=Math.max(local,delta);maxError=Math.max(maxError,delta)}if(local>0)errorPixels++;
 const pi=i/4,xx=pi%w,yy=Math.floor(pi/w),tile=tiles[Math.floor(yy/tileSize)*cols+Math.floor(xx/tileSize)];
 tile.absoluteError+=local;tile.maxError=Math.max(tile.maxError,local);
 if(local>2)tile.pixelsOver2++;
 if(local>16)tile.pixelsOver16++;
 for(const threshold of [0,2,8,16,32,64,128])if(local>threshold)thresholds['over'+threshold]++;
 if(local>largestError.value)largestError={x:xx,y:yy,value:local};
 weightedErrorTotal+=local;
if(ref[i+3]>0||output.data[i+3]>0){visibleMismatch++;for(let j=0;j<3;j++)compositedRGBAbs+=Math.abs(ref[i+j]*ref[i+3]/255-output.data[i+j]*output.data[i+3]/255)}alphaAbs+=Math.abs(ref[i+3]-output.data[i+3]);d.data[i]=Math.min(255,Math.abs(ref[i]-output.data[i])*4);d.data[i+1]=Math.min(255,Math.abs(ref[i+1]-output.data[i+1])*4);d.data[i+2]=Math.min(255,Math.abs(ref[i+2]-output.data[i+2])*4);d.data[i+3]=255}
 dctx.putImageData(d,0,0);
 const hot=makeCanvas(w,h),hctx=hot.getContext('2d');
 for(const tile of tiles){const v=tile.absoluteError/(tile.width*tile.height);const intensity=Math.min(1,v/16);if(!intensity)continue;hctx.fillStyle=`rgba(255,${Math.round(180*(1-intensity))},0,${Math.max(0.15,intensity)})`;hctx.fillRect(tile.x,tile.y,tile.width,tile.height)}
 const sortedTiles=[...tiles].sort((a,b)=>b.absoluteError-a.absoluteError);
 const spatial={tileSize,thresholds,largestError,topTiles:sortedTiles.slice(0,20).map(t=>({...t,meanMaxChannelError:t.absoluteError/(t.width*t.height)})),top10ErrorShare:weightedErrorTotal?sortedTiles.slice(0,10).reduce((acc,t)=>acc+t.absoluteError,0)/weightedErrorTotal:0};
 comparison={differencePixels:errorPixels,totalPixels:w*h,meanAbsError:totalAbs/(w*h*4),meanPremultipliedRgbError:compositedRGBAbs/(w*h*3),meanAlphaError:alphaAbs/(w*h),maxError,nontransparentPixels:visibleMismatch,spatial,diffBitmap:diff.transferToImageBitmap(),heatmapBitmap:hot.transferToImageBitmap()};}
 const pixels=output.data;let checksum=2166136261;for(let i=0;i<pixels.length;i++){checksum^=pixels[i];checksum=Math.imul(checksum,16777619)}
 return {workerVersion:WORKER_VERSION,renderEngineRevision:RENDER_ENGINE_REVISION,renderOptions:{enableMasks,enableClipping,enablePassThrough,forceVisible:!!options.forceVisible,reverseOrder:!!options.reverseOrder},checksum:(checksum>>>0).toString(16).padStart(8,'0'),bitmap:c.transferToImageBitmap(),comparison,warnings:[...warnings].slice(0,150),drawn:counts.drawn,missing:counts.emptyImage,trace,counts,mode:options.debugMode?'diagnostic-preview':(options.visibilityMap?'classification-preview':(options.forceVisible?'force-visible':'original')),order:options.reverseOrder?'diagnostic-reversed':'verified',features:{enableMasks,enableClipping,enablePassThrough},debug:{mode:options.debugMode||null,skipLayerId:options.debugSkipLayerId||null,onlyLayerId:options.debugOnlyLayerId||null,normalBlendId:options.debugNormalBlendId||null}};
}
function findNode(nodes,id,prefix='r'){for(let i=0;i<(nodes||[]).length;i++){const l=nodes[i],key=prefix+'/'+i;if(key===id)return l;if(l.children){const result=findNode(l.children,id,key);if(result)return result}}return null}
self.postMessage({type:'ready',workerVersion:WORKER_VERSION,renderEngineRevision:RENDER_ENGINE_REVISION});
self.onmessage=e=>{const m=e.data;try{if(m?.type==='parse'){init();psdDoc=null;const psd=agPsd.readPsd(m.buffer,{skipLayerImageData:false,skipThumbnail:true,skipLinkedFilesData:true,skipCompositeImageData:false,logMissingFeatures:false});if(psd.width>10000||psd.height>10000||psd.width*psd.height>25000000)throw Error('キャンバスが大きすぎます');psdDoc=psd;docInfo={filename:m.filename,width:psd.width,height:psd.height,colorMode:psd.colorMode,version:psd.version,nodes:normalize(psd.children)};const refCanvas=psd.canvas?makeCanvas(psd.width,psd.height):null;if(refCanvas)refCanvas.getContext('2d').drawImage(psd.canvas,0,0);const ref=refCanvas?refCanvas.transferToImageBitmap():null;self.postMessage({type:'result',report:docInfo,workerVersion:WORKER_VERSION,bitmap:ref},ref?[ref]:[])}else if(m?.type==='render'){const r=render(m.options||{});const transfer=[r.bitmap];if(r.comparison?.diffBitmap)transfer.push(r.comparison.diffBitmap);if(r.comparison?.heatmapBitmap)transfer.push(r.comparison.heatmapBitmap);self.postMessage({type:'rendered',...r},transfer)}else if(m?.type==='isolate'){const n=findNode(psdDoc?.children,m.nodeId);if(!n)throw Error('レイヤーが見つかりません: '+m.nodeId);const c=makeCanvas(psdDoc.width,psdDoc.height),ctx=c.getContext('2d');const nodes=[];function paint(node){if(isGroup(node)){for(const ch of node.children)paint(ch)}else if(node.canvas){ctx.save();ctx.globalAlpha=(node.opacity??1)>1?node.opacity/255:(node.opacity??1);ctx.globalCompositeOperation=blendMap[node.blendMode||'normal']||'source-over';ctx.drawImage(node.canvas,node.left||0,node.top||0);ctx.restore();nodes.push(node.name||'')}}paint(n);const bitmap=c.transferToImageBitmap();self.postMessage({type:'isolated',bitmap,nodeId:m.nodeId,names:nodes},[bitmap])}}catch(err){self.postMessage({type:'error',operation:m?.type,error:String(err?.stack||err)})}};
