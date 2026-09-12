const { getStatusBarHeight } = require('../../utils/system');
const c = require('../../utils/career');
const t = require('../../utils/careerTime');
Component({
  properties: {
    error: String, date: String, time: String,
    title: { type: String, value: '选择面试时间' },
    showDuration: { type: Boolean, value: false },
    duration: { type: String, value: '60' },
  },
  data: { brandHeight: getStatusBarHeight() + 50,
    closing: false, sheetExitStyle: '', maskExitStyle: '',
    days: [], weeks: [], weekdays: ['一','二','三','四','五','六','日'],
    hours: Array.from({length:24},(_,i)=>t.pad(i)),
    minutes: Array.from({length:60},(_,i)=>t.pad(i)),
    wheel: [10,0], selected: '', selectedLabel: '', month: '', monthLabel: '', timeLabel: '10:00', rolling: false,
    durationOptions: [30,60,90], customDuration: false, summary: '',
    durationEditorOpen: false, durationDraft: '', durationError: '',
    durationSheetExitStyle: '', durationMaskExitStyle: '', durationClosing: false,
    durationKeys: ['1','2','3','4','5','6','7','8','9','清空','0','删除'],
  },
  lifetimes: {
    attached() {
      c.sheetMotion.reset(this);
      const selected=this.properties.date || c.dateParts().date;
      const [h,m]=(this.properties.time || '10:00').split(':').map(Number);
      const duration=String(this.properties.duration || '60');
      this.setData({selected,month:selected.slice(0,7),wheel:[h,m],timeLabel:t.pad(h)+':'+t.pad(m),duration,customDuration:!['30','60','90'].includes(duration)});
      this.renderDays();
    },
    detached() { c.sheetMotion.dispose(this); clearTimeout(this._durationCloseTimer); },
  },
  methods: {
    noop() {},
    renderDays() {
      const [year,month]=this.data.month.split('-');
      const days=t.monthDays(this.data.month,this.data.selected);
      this.setData({days,weeks:Array.from({length:6},(_,i)=>({key:days[i*7].value,days:days.slice(i*7,i*7+7)})),selectedLabel:Number(this.data.selected.slice(5,7))+'月'+Number(this.data.selected.slice(8,10))+'日',monthLabel:year+'年'+Number(month)+'月'});
      this.updateSummary();
    },
    updateSummary() {
      const weekday=['日','一','二','三','四','五','六'][new Date(this.data.selected+'T12:00:00+08:00').getUTCDay()];
      let range=this.data.timeLabel;
      if(this.properties.showDuration) {
        const end=t.withDuration({startDate:this.data.selected,startTime:this.data.timeLabel},this.data.duration);
        range+='—'+(end.endDate!==this.data.selected ? Number(end.endDate.slice(5,7))+'月'+Number(end.endDate.slice(8,10))+'日 ' : '')+end.endTime;
      }
      this.setData({summary:this.data.selectedLabel+' 周'+weekday+' · '+range});
    },
    navigate(e) { this.setData({month:t.shiftMonth(this.data.month,Number(e.currentTarget.dataset.delta))});this.renderDays(); },
    selectDate(e) { const selected=e.currentTarget.dataset.date;this.setData({selected,month:selected.slice(0,7)});this.renderDays(); },
    today() { const selected=c.dateParts().date;this.setData({selected,month:selected.slice(0,7)});this.renderDays(); },
    rollStart(e) { this._rolling=this._rolling || new Set();this._rolling.add(e?.currentTarget?.dataset?.part || 'both');this.setData({rolling:true}); },
    rollEnd(e) { if(this._rolling)this._rolling.delete(e?.currentTarget?.dataset?.part || 'both');this.setData({rolling:!!this._rolling?.size}); },
    changeTime(e) {
      const wheel=[...this.data.wheel],part=e.currentTarget?.dataset?.part;
      if(part==='hour') wheel[0]=e.detail.value[0];
      else if(part==='minute') wheel[1]=e.detail.value[0];
      else { wheel[0]=e.detail.value[0];wheel[1]=e.detail.value[1]; }
      this.setData({wheel,timeLabel:t.pad(wheel[0])+':'+t.pad(wheel[1])});this.updateSummary();
    },
    selectDuration(e) {
      if(this.data.durationClosing || this._closing) return;
      const duration=String(e.currentTarget.dataset.minutes);
      if(duration==='custom') {
        this.setData({durationEditorOpen:true,durationDraft:this.data.customDuration?this.data.duration:'',durationError:'',durationClosing:false,durationSheetExitStyle:'',durationMaskExitStyle:''});return;
      }
      this.setData({duration,customDuration:false});this.updateSummary();
    },
    pressDurationKey(e) {
      if(!this.data.durationEditorOpen || this.data.durationClosing) return;
      const key=e.currentTarget.dataset.key;let draft=this.data.durationDraft;
      if(key==='清空')draft='';else if(key==='删除')draft=draft.slice(0,-1);
      else if(/^[0-9]$/.test(key) && draft.length<5)draft=(draft==='0'?'':draft)+key;
      this.setData({durationDraft:draft,durationError:''});
    },
    closeDuration() {
      if(this.data.durationClosing || !this.data.durationEditorOpen)return;
      this.setData({durationClosing:true,durationSheetExitStyle:'transform:translateY(100%);transition:transform 240ms ease-in;',durationMaskExitStyle:'opacity:0;transition:opacity 240ms ease-in;'});
      this._durationCloseTimer=setTimeout(()=>{if(!this._disposed)this.setData({durationEditorOpen:false,durationClosing:false,durationError:''});},240);
    },
    cancelDuration() { this.closeDuration(); },
    confirmDuration() {
      if(this.data.durationClosing || !this.data.durationEditorOpen)return;
      try {t.withDuration({startDate:this.data.selected,startTime:this.data.timeLabel},this.data.durationDraft);}
      catch(error){this.setData({durationError:error.message});return;}
      this.setData({duration:String(Number(this.data.durationDraft)),customDuration:true});this.updateSummary();this.closeDuration();
    },
    close() { if(this.data.durationEditorOpen){this.closeDuration();return;}c.sheetMotion.dismiss(this); },
    confirm() {
      if(this.data.rolling || this._closing || this.data.durationEditorOpen)return;
      this.triggerEvent('confirm',{date:this.data.selected,time:this.data.timeLabel,...(this.properties.showDuration?{duration:this.data.duration}:{})});
    },
  },
});
