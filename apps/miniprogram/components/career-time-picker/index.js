const c = require('../../utils/career');
const t = require('../../utils/careerTime');
Component({
  properties: {error:String, date:String, time:String, title:{type:String,value:'选择面试时间'}},
  data: {days:[], weeks:[], selectedLabel:'', weekdays:['一','二','三','四','五','六','日'], hours:Array.from({length:24},(_,i)=>t.pad(i)), minutes:Array.from({length:60},(_,i)=>t.pad(i)), wheel:[10,0], selected:'', month:'', monthLabel:'', timeLabel:'10:00', rolling:false},
  lifetimes: {attached() {
    const selected=this.properties.date || c.dateParts().date;
    const [h,m]=(this.properties.time || '10:00').split(':').map(Number);
    this.setData({selected,month:selected.slice(0,7),wheel:[h,m],timeLabel:t.pad(h)+':'+t.pad(m)});
    this.renderDays();
  }},
  methods: {
    noop(){},
    renderDays(){const [year,month]=this.data.month.split('-');const days=t.monthDays(this.data.month,this.data.selected);this.setData({days,weeks:Array.from({length:6},(_,i)=>({key:days[i*7].value,days:days.slice(i*7,i*7+7)})),selectedLabel:Number(this.data.selected.slice(5,7))+'月'+Number(this.data.selected.slice(8,10))+'日',monthLabel:year+'年'+Number(month)+'月'});},
    navigate(e){this.setData({month:t.shiftMonth(this.data.month,Number(e.currentTarget.dataset.delta))});this.renderDays();},
    today(){const selected=c.dateParts().date;this.setData({selected,month:selected.slice(0,7)});this.renderDays();},
    selectDate(e){const selected=e.currentTarget.dataset.date;this.setData({selected,month:selected.slice(0,7)});this.renderDays();},
    rollStart(){this.setData({rolling:true});},
    rollEnd(){this.setData({rolling:false});},
    changeTime(e){const [h,m]=e.detail.value;this.setData({wheel:[h,m],timeLabel:t.pad(h)+':'+t.pad(m)});},
    close(){this.triggerEvent('close');},
    confirm(){if(!this.data.rolling)this.triggerEvent('confirm',{date:this.data.selected,time:this.data.timeLabel});},
  }
});
