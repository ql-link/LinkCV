const editor = require('../../utils/careerEditor')();
const c = require('../../utils/career');
const f = require('../../utils/careerForm');
Page({
  ...editor,
  data:{...editor.data,timeEditorOpen:false,pickerDate:'',pickerTime:'',pickerTitle:'',sessionLabel:''},
  updateButton(){
    editor.updateButton.call(this);
    if(this.data.session)this.setData({sessionLabel:c.dateParts(this.data.session.start_at).date+' '+c.dateParts(this.data.session.start_at).time});
  },
  chooseDateTime(e){
    if(this.data.saving || this.data.stageLocked)return;
    const target=e.currentTarget.dataset.target;
    this.setData({timeEditorOpen:true,timeTarget:target,pickerDate:this.data.form[target+'Date'] || c.dateParts().date,pickerTime:this.data.form[target+'Time'],pickerTitle:target==='start'?'选择开始时间':'选择结束时间'});
  },
  closeDateTime(){this.setData({timeEditorOpen:false});},
  acceptDateTime(e){
    if(this.data.saving || this.data.stageLocked)return;
    const form={...this.data.form,[this.data.timeTarget+'Date']:e.detail.date,[this.data.timeTarget+'Time']:e.detail.time};
    try{if(form.startTime && form.endTime)f.timeRange(form,true);}catch(error){this.setData({error:error.message});return;}
    this.setData({form,timeEditorOpen:false,error:''});this._dirty=true;
    if(wx.enableAlertBeforeUnload)wx.enableAlertBeforeUnload({message:'当前填写内容尚未保存，离开后会丢失。'});
    this.updateButton();
  },
});
