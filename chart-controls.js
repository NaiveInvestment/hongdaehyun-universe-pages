const escape = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function validAxis(min, max) {
  return Number.isFinite(min) && Number.isFinite(max) && max > min && Number.isFinite(max-min);
}

// Keep the midpoint fixed while stretching the price scale vertically.
export function scaleAxis(domain, factor) {
  if (!domain || !validAxis(domain.min, domain.max) || !Number.isFinite(factor) || factor <= 0) return null;
  const span = domain.max - domain.min;
  const center = domain.min + span / 2;
  const nextSpan = Math.max(.000001, span * factor);
  const result = {min: center - nextSpan / 2, max: center + nextSpan / 2};
  return validAxis(result.min, result.max) ? result : null;
}

export function zoomAxis(domain, ends, direction) {
  if (!domain) return null;
  const span = domain.max - domain.min;
  if (!validAxis(domain.min, domain.max)) return null;
  const values = ends.filter(value=>Number.isFinite(value)&&value>=domain.min&&value<=domain.max).sort((a,b)=>a-b);
  const center = direction === 'in' && values.length
    ? values[Math.floor(values.length / 2)] : domain.min + span / 2;
  const nextSpan = Math.max(0.01, span * (direction === 'in' ? .65 : 1 / .65));
  const result = { min: center - nextSpan / 2, max: center + nextSpan / 2 };
  return validAxis(result.min,result.max) ? result : null;
}

export const chartControls = {
  models: new Map(), axes: new Map(), editors: new Set(), expandedKey: null,
  register(key, options) {
    const model={ ...this.models.get(key), options };
    if(!options.series.some(item=>(item.values||[]).some(Number.isFinite))){delete model.domain;delete model.autoDomain;model.ends=[];model.outside=0;}
    this.models.set(key,model);
  },
  axis(key) { return this.axes.get(key); },
  metrics(key, value) { Object.assign(this.models.get(key), value); },
  tools(key, label) {
    if (this.models.has(key)) this.models.get(key).label = label;
    return `<span class="chart-actions">
      <button type="button" class="btn tiny chart-expand" data-chart-expand="${escape(key)}" title="차트 확대 보기" aria-label="${escape(label)} 확대 보기"><svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true"><path d="M2 7V2h5M13 2h5v5M18 13v5h-5M7 18H2v-5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>
    </span>`;
  },
  editor(key) {
    const model = this.models.get(key);
    const domain = this.axis(key) || model?.domain || {min:0,max:200};
    const manual = this.axes.has(key);
    const digits=Math.min(10,Math.max(1,Math.ceil(-Math.log10((domain.max-domain.min)/4))+1));
    const bound=value=>Math.abs(value)>=1e6?value.toExponential(2):String(Number(value.toFixed(digits)));
    const notice = manual ? `<span class="chart-axis-status">Y축 ${bound(domain.min)}–${bound(domain.max)}${model?.outside ? `, 범위 밖 ${model.outside}개 선` : ''}</span>` : '';
    return `<div class="chart-axis-slot" data-chart-axis-slot="${escape(key)}">${notice}${manual?`<button class="btn tiny" type="button" data-chart-reset="${escape(key)}">자동</button>`:''}</div>`;
  },
  normalSvg(key) {
    return [...document.querySelectorAll('svg[data-chart-key]')].find(el=>el.dataset.chartKey===key&&!el.closest('#chartDialog'));
  },
  surface(key) { return [...document.querySelectorAll('[data-chart-surface]')].find(el=>el.dataset.chartSurface===key); },
  refresh(key, gesture = false) {
    const svg=this.normalSvg(key), model=this.models.get(key);
    if(svg&&model){const width=svg.getBoundingClientRect().width;svg.outerHTML=this.draw({...model.options,width,chartKey:key});}
    for(const slot of document.querySelectorAll('[data-chart-axis-slot]')){
      if(slot.dataset.chartAxisSlot===key)slot.outerHTML=this.editor(key);
    }
    for(const button of document.querySelectorAll('[data-chart-axis-toggle]')){
      if(button.dataset.chartAxisToggle===key)button.setAttribute('aria-expanded',String(this.editors.has(key)));
    }
    if(this.expandedKey===key){
      const expanded=this.dialog.querySelector('svg[data-chart-key]');
      if(gesture&&expanded){const box=expanded.viewBox.baseVal;expanded.outerHTML=this.draw({...model.options,width:box.width,height:box.height,chartKey:key,expanded:true});}
      else this.renderExpanded();
    }
  },
  open(key) {
    if(!this.models.has(key))return;
    this.expandedKey=key;
    this.renderExpanded();
    if(!this.dialog.open)this.dialog.showModal();
    document.body.classList.add('chart-dialog-open');
    this.dialog.querySelector('[data-chart-close]')?.focus();
  },
  close() {
    this.endDrag();
    const key=this.expandedKey;this.expandedKey=null;this.dialog.close();document.body.classList.remove('chart-dialog-open');
    document.querySelector(`[data-chart-expand="${CSS.escape(key||'')}"]`)?.focus();
  },
  renderExpanded() {
    const key=this.expandedKey,model=this.models.get(key);if(!key||!model)return;
    const active=document.activeElement;
    let focusSelector=null;
    if(this.dialog.contains(active)){
      for(const attribute of ['data-chart-zoom','data-chart-axis-toggle','data-chart-reset','data-chart-close','data-range','data-rare-range','data-home-chart-expand','data-company-line','data-rare-symbol']){
        if(active.hasAttribute(attribute)){focusSelector=`[${attribute}="${CSS.escape(active.getAttribute(attribute))}"]`;break;}
      }
      if(active.tagName==='INPUT')focusSelector=`input[name="${CSS.escape(active.name)}"]`;
      if(active.type==='submit')focusSelector='button[type="submit"]';
    }
    const surface=this.surface(key);
    const periods=[...(surface?.querySelectorAll('[data-range],[data-rare-range],[data-home-chart-expand]')||[])].map(el=>el.outerHTML).join('');
    const legend=surface?.querySelector('.chart-legend')?.outerHTML||'';
    const width=Math.max(280,window.innerWidth-(window.innerWidth<=640?38:80));
    const height=Math.max(240,Math.min(850,window.innerHeight-(window.innerWidth<=640?300:180)));
    this.dialog.innerHTML=`<div class="chart-dialog-head"><h2 id="chartDialogTitle">${escape(model.label||'주가 추이')}</h2><button type="button" class="btn chart-dialog-close" data-chart-close aria-label="확대 차트 닫기">×</button></div>
      <div class="chart-dialog-toolbar"><span class="tools">${periods}</span>${this.tools(key,model.label||'주가 추이')}</div>
      ${this.editor(key)}${this.draw({...model.options,width,height,chartKey:key,expanded:true})}${legend}`;
    this.dialog.querySelector('[data-chart-expand]')?.remove();
    if(focusSelector)this.dialog.querySelector(focusSelector)?.focus({preventScroll:true});
  },
  init({draw,onPeriod,onLegend,onHomeToggle}) {
    if(this.dialog)return;
    Object.assign(this,{draw,onPeriod,onLegend,onHomeToggle});
    this.dialog=document.createElement('dialog');this.dialog.id='chartDialog';this.dialog.className='chart-dialog';this.dialog.setAttribute('aria-labelledby','chartDialogTitle');document.body.append(this.dialog);
    this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});
    this.dialog.addEventListener('close',()=>{if(!this.dialog.open)document.body.classList.remove('chart-dialog-open');});
    this.initAxisGestures();
    this.dialog.addEventListener('click',event=>{if(event.target===this.dialog){const r=this.dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)this.close();}});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.dialog.open){event.preventDefault();event.stopImmediatePropagation();this.close();}});
    document.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.hasAttribute('data-chart-expand')){this.open(button.dataset.chartExpand);return;}
      if(button.hasAttribute('data-chart-close')){this.close();return;}
      if(button.hasAttribute('data-chart-axis-toggle')){const key=button.dataset.chartAxisToggle;this.editors.has(key)?this.editors.delete(key):this.editors.add(key);this.refresh(key);return;}
      if(button.hasAttribute('data-chart-reset')){const key=button.dataset.chartReset;this.axes.delete(key);this.refresh(key);return;}
      if(button.hasAttribute('data-chart-zoom')){
        const key=button.dataset.chartTarget,model=this.models.get(key);if(!model)return;
        const axis=zoomAxis(this.axis(key)||model.domain,model.ends||[],button.dataset.chartZoom);if(axis)this.axes.set(key,axis);this.refresh(key);return;
      }
      if(!button.closest('#chartDialog'))return;
      if(button.hasAttribute('data-range')||button.hasAttribute('data-rare-range')){this.onPeriod(button.hasAttribute('data-rare-range')?'rare':'common',button.dataset.rareRange||button.dataset.range);this.renderExpanded();return;}
      if(button.hasAttribute('data-home-chart-expand')){this.onHomeToggle();this.renderExpanded();return;}
      if(button.hasAttribute('data-company-line')||button.hasAttribute('data-rare-symbol')){this.onLegend(button.hasAttribute('data-company-line')?'company':'rare',button.dataset.companyLine||button.dataset.rareSymbol);this.renderExpanded();}
    });
    document.addEventListener('submit',event=>{
      const form=event.target.closest('[data-chart-axis-form]');if(!form)return;event.preventDefault();
      const min=form.elements.min.value.trim()===''?NaN:Number(form.elements.min.value),max=form.elements.max.value.trim()===''?NaN:Number(form.elements.max.value);
      if(!validAxis(min,max)){form.querySelector('.chart-axis-error').textContent='최대값을 최소값보다 크게 입력하세요.';return;}
      const key=form.dataset.chartAxisForm;this.axes.set(key,{min,max});this.refresh(key);
    });
    let timer;window.addEventListener('resize',()=>{if(this.dialog.open){clearTimeout(timer);timer=setTimeout(()=>this.renderExpanded(),160);}});
  },
  endDrag() {
    const drag=this.drag;if(!drag)return;
    this.drag=null;document.body.classList.remove('chart-axis-dragging');
    if(document.body.hasPointerCapture(drag.id))document.body.releasePointerCapture(drag.id);
  },
  initAxisGestures() {
    const hit=event=>event.target.closest?.('[data-chart-axis-hit]');
    document.addEventListener('pointerdown',event=>{
      const axis=hit(event);if(!axis||event.button!==0||this.drag)return;
      const key=axis.closest('svg').dataset.chartKey,domain=this.axis(key)||this.models.get(key)?.domain;
      if(!domain||!validAxis(domain.min,domain.max))return;
      event.preventDefault();event.stopPropagation();
      this.drag={key,id:event.pointerId,startY:event.clientY,height:Math.max(1,axis.getBoundingClientRect().height),domain:{...domain},previous:this.axis(key)};
      document.body.setPointerCapture(event.pointerId);
      document.body.classList.add('chart-axis-dragging');
    });
    document.addEventListener('pointermove',event=>{
      const drag=this.drag;if(!drag||event.pointerId!==drag.id)return;
      event.preventDefault();
      const delta=event.clientY-drag.startY;if(Math.abs(delta)<2&&!drag.moved)return;
      drag.moved=true;
      const axis=scaleAxis(drag.domain,Math.exp(Math.max(-12,Math.min(12,delta/drag.height*3))));
      if(axis){this.axes.set(drag.key,axis);this.refresh(drag.key,true);}
    });
    document.addEventListener('pointerup',event=>{if(event.pointerId===this.drag?.id)this.endDrag();});
    document.addEventListener('pointercancel',event=>{
      const drag=this.drag;if(event.pointerId!==drag?.id)return;
      drag.previous?this.axes.set(drag.key,drag.previous):this.axes.delete(drag.key);
      this.endDrag();this.refresh(drag.key,true);
    });
    document.body.addEventListener('lostpointercapture',()=>this.endDrag());
    window.addEventListener('blur',()=>this.endDrag());
    document.addEventListener('wheel',event=>{
      const axis=hit(event);if(!axis||this.drag)return;
      const key=axis.closest('svg').dataset.chartKey,domain=this.axis(key)||this.models.get(key)?.domain;
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?axis.getBoundingClientRect().height:1);
      const next=scaleAxis(domain,Math.exp(Math.max(-1,Math.min(1,delta*.002))));
      if(next){event.preventDefault();this.axes.set(key,next);this.refresh(key,true);}
    },{passive:false});
    document.addEventListener('dblclick',event=>{
      // Pointer capture can retarget the subsequent click to the capture owner.
      const axis=hit(event)||document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-chart-axis-hit]');
      if(!axis)return;event.preventDefault();
      const key=axis.closest('svg').dataset.chartKey;this.axes.delete(key);this.refresh(key,true);
    });
    document.addEventListener('keydown',event=>{
      const axis=hit(event);if(!axis||!['ArrowUp','ArrowDown','Home'].includes(event.key))return;
      event.preventDefault();const key=axis.closest('svg').dataset.chartKey;
      if(event.key==='Home')this.axes.delete(key);
      else {const next=scaleAxis(this.axis(key)||this.models.get(key)?.domain,event.key==='ArrowUp'?.85:1/.85);if(next)this.axes.set(key,next);}
      const expanded=!!axis.closest('#chartDialog');this.refresh(key,true);
      const svg=expanded?this.dialog.querySelector('svg[data-chart-key]'):this.normalSvg(key);
      svg?.querySelector('[data-chart-axis-hit]')?.focus({preventScroll:true});
    });
  },
};
