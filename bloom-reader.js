/* Bloom Reader: private PDF rendering + text-layer extraction + OCR fallback. */
(function(root){
  'use strict';

  const PDFJS_VERSION='6.5.438';
  const TESSERACT_VERSION='7.0.0';
  let pdfJsPromise=null;
  let tesseractPromise=null;
  let ocrWorkerPromise=null;

  function cleanText(value){
    return String(value||'')
      .replace(/\u00ad/g,'')
      .replace(/[ \t]+\n/g,'\n')
      .replace(/\n{3,}/g,'\n\n')
      .replace(/[ \t]{2,}/g,' ')
      .trim();
  }

  async function pdfJs(){
    if(!pdfJsPromise){
      pdfJsPromise=import('https://cdn.jsdelivr.net/npm/pdfjs-dist@'+PDFJS_VERSION+'/build/pdf.mjs').then(mod=>{
        mod.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@'+PDFJS_VERSION+'/build/pdf.worker.mjs';
        return mod;
      });
    }
    return pdfJsPromise;
  }

  async function tesseract(){
    if(root.Tesseract) return root.Tesseract;
    if(!tesseractPromise){
      tesseractPromise=new Promise((resolve,reject)=>{
        const script=root.document.createElement('script');
        script.src='https://cdn.jsdelivr.net/npm/tesseract.js@'+TESSERACT_VERSION+'/dist/tesseract.min.js';
        script.crossOrigin='anonymous';
        script.onload=()=>root.Tesseract?resolve(root.Tesseract):reject(new Error('Tesseract OCR did not initialize.'));
        script.onerror=()=>reject(new Error('The OCR library could not be loaded.'));
        root.document.head.appendChild(script);
      });
    }
    return tesseractPromise;
  }

  async function worker(onProgress){
    if(!ocrWorkerPromise){
      ocrWorkerPromise=tesseract().then(T=>T.createWorker('eng',1,{
        logger(message){
          if(typeof onProgress==='function') onProgress(message);
        }
      }));
    }
    return ocrWorkerPromise;
  }

  async function terminateWorker(){
    if(!ocrWorkerPromise) return;
    try{
      const w=await ocrWorkerPromise;
      await w.terminate();
    }catch(_){}
    ocrWorkerPromise=null;
  }

  async function loadDocument(url){
    const pdf=await pdfJs();
    return pdf.getDocument({url,disableAutoFetch:false,disableStream:false}).promise;
  }

  async function renderPage(doc,pageNumber,canvas,scale){
    if(!doc||!canvas) throw new Error('Bloom Reader is missing the PDF page canvas.');
    const page=await doc.getPage(pageNumber);
    const viewport=page.getViewport({scale:Number(scale)||1.25});
    const ratio=Math.max(1,Math.min(2,root.devicePixelRatio||1));
    canvas.width=Math.floor(viewport.width*ratio);
    canvas.height=Math.floor(viewport.height*ratio);
    canvas.style.width=Math.floor(viewport.width)+'px';
    canvas.style.height=Math.floor(viewport.height)+'px';
    const context=canvas.getContext('2d',{alpha:false});
    context.setTransform(ratio,0,0,ratio,0,0);
    await page.render({canvasContext:context,viewport}).promise;
    return {width:viewport.width,height:viewport.height};
  }

  async function extractText(doc,pageNumber){
    const page=await doc.getPage(pageNumber);
    const content=await page.getTextContent();
    const chunks=[];
    for(const item of content.items||[]){
      const value=String(item.str||'');
      if(value) chunks.push(value);
      if(item.hasEOL) chunks.push('\n');
      else chunks.push(' ');
    }
    return cleanText(chunks.join(''));
  }

  async function pageCanvas(doc,pageNumber,scale){
    const page=await doc.getPage(pageNumber);
    const viewport=page.getViewport({scale:Number(scale)||2.2});
    const canvas=root.document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);
    canvas.height=Math.ceil(viewport.height);
    const ctx=canvas.getContext('2d',{alpha:false});
    await page.render({canvasContext:ctx,viewport}).promise;
    return canvas;
  }

  async function ocrPage(doc,pageNumber,onProgress){
    const canvas=await pageCanvas(doc,pageNumber,2.25);
    const w=await worker(onProgress);
    const result=await w.recognize(canvas);
    return cleanText(result&&result.data&&result.data.text);
  }

  async function processPage(doc,pageNumber,options){
    options=options||{};
    const minimum=Number.isFinite(options.minimumTextChars)?options.minimumTextChars:80;
    if(typeof options.onStage==='function') options.onStage({page:pageNumber,stage:'text-layer'});
    let text='';
    try{text=await extractText(doc,pageNumber);}catch(_){}
    if(text.replace(/\s/g,'').length>=minimum){
      return {page_number:pageNumber,extraction_method:'text_layer',raw_text:text,char_count:text.length};
    }
    if(typeof options.onStage==='function') options.onStage({page:pageNumber,stage:'ocr'});
    text=await ocrPage(doc,pageNumber,message=>{
      if(typeof options.onOcrProgress==='function') options.onOcrProgress({page:pageNumber,...message});
    });
    return {page_number:pageNumber,extraction_method:'ocr',raw_text:text,char_count:text.length};
  }

  async function processRange(doc,start,end,options){
    const results=[];
    const first=Math.max(1,Math.floor(Number(start)||1));
    const last=Math.min(doc.numPages,Math.max(first,Math.floor(Number(end)||first)));
    try{
      for(let page=first;page<=last;page++){
        if(typeof options?.onPageStart==='function') options.onPageStart(page,first,last);
        const result=await processPage(doc,page,options);
        results.push(result);
        if(typeof options?.onPageDone==='function') options.onPageDone(result,page-first+1,last-first+1);
      }
      return results;
    }finally{
      await terminateWorker();
    }
  }

  function candidateWords(text,limit){
    const stop=new Set(['about','after','again','against','because','before','being','between','could','every','first','from','have','into','little','more','other','should','their','there','these','they','this','those','through','under','very','were','what','when','where','which','while','with','would','your']);
    const counts=new Map();
    for(const raw of String(text||'').toLowerCase().match(/[a-z][a-z'-]{5,}/g)||[]){
      const word=raw.replace(/^'+|'+$/g,'');
      if(stop.has(word)||word.length<6) continue;
      counts.set(word,(counts.get(word)||0)+1);
    }
    return Array.from(counts.entries()).sort((a,b)=>a[1]-b[1]||b[0].length-a[0].length||a[0].localeCompare(b[0])).slice(0,limit||12).map(([word])=>word);
  }

  root.BloomReader={
    PDFJS_VERSION,TESSERACT_VERSION,loadDocument,renderPage,extractText,ocrPage,processPage,processRange,candidateWords,terminateWorker
  };
})(typeof window!=='undefined'?window:globalThis);
