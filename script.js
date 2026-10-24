const $=s=>document.querySelector(s);
const money=v=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const today=new Date();
const iso=d=>d.toISOString().slice(0,10);
let products=[];
let transactions=[];
let units=[];
let cart=[];
let currentUser=JSON.parse(localStorage.getItem('mf_current_user')||'null');
const authAccountKey='mf_account';
const profileStorageKey='mf_profiles_v1';
const notificationChannelsKey='mf_notification_channels_v1';
const dashboardActivityFromKey='mf_dashboard_activity_from';
const dashboardActivityToKey='mf_dashboard_activity_to';
const staffTasksKey='mf_staff_tasks_v1';
const staffNoticesKey='mf_staff_notices_v1';
let profiles=[];
let staffTasks=[];
let staffNotices=[];
let notificationChannelList=[];
let selectedProfileId=null;
let editingProfileId=null;
let pendingProfilePhoto='';
let pendingEmployeePhoto='';
let spreadsheetImports=[];
let spreadsheetImportMessage='';
let pendingSpreadsheetProducts=[];
let activeSpreadsheetPreviewIndex=0;
let pendingSpreadsheetDestinations=[];
let expirySearchQuery='';
let activeExpiryCategory='';
let pendingLossProductId='';
const selectedStockProductIds=new Set();
function normalizedUnitName(value){return String(value||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function productUnitId(product){return [product?.unitId,product?.unidade_id,product?.unit_id].map(value=>String(value??'').trim()).find(Boolean)||''}
function selectedUnitId(){const value=localStorage.getItem('mf_selected_unit')||'all';return value==='all'||!units.some(unit=>String(unit.id)===value)?'all':value}
function selectedUnitName(){return selectedUnitId()==='all'?'':units.find(unit=>String(unit.id)===selectedUnitId())?.name||''}
function productUnitName(product){return units.find(unit=>String(unit.id)===productUnitId(product))?.name||product?.unitName||'Sem unidade'}
function unitDisplayName(name){return String(name||'').replace(/^condom[ií]nio\s+/i,'Cond. ')}
function matchesSelectedUnit(record){
 const selected=selectedUnitId();
 if(selected==='all')return true;
 const unit=units.find(item=>String(item.id)===selected);
 const recordId=record&&('unitId'in record||'unidade_id'in record||'unit_id'in record)?productUnitId(record):String(record?.unitId||'');
 return recordId===selected||Boolean(unit&&normalizedUnitName(record?.unit)===normalizedUnitName(unit.name));
}
function createUnit(name,details={}){
 const trimmed=String(name||'').trim();
 if(!trimmed)throw new Error('O nome da unidade é obrigatório.');
 const existing=units.find(unit=>normalizedUnitName(unit.name)===normalizedUnitName(trimmed));
 if(existing)return existing;
 let id=Date.now();
 while(units.some(unit=>String(unit.id)===String(id)))id++;
 const unit={id,name:trimmed,location:details.location||trimmed,block:details.block||'',manager:details.manager||'',status:details.status||'Ativo'};
 units.push(unit);
 return unit;
}
function migrateProductUnits(){
 let changed=false;
 units=Array.isArray(units)?units:[];
 products=Array.isArray(products)?products:[];
 products.forEach(product=>{
  const storedId=productUnitId(product);
  let unit=units.find(item=>String(item.id)===storedId);
  if(!unit){
   const unitName=product.unitName||'Condomínio Freitas';
   unit=units.find(item=>normalizedUnitName(item.name)===normalizedUnitName(unitName))||createUnit(unitName);
   changed=true;
  }
  const id=String(unit.id);
  if(product.unitId!==id||product.unidade_id!==id){product.unitId=id;product.unidade_id=id;changed=true}
 });
 const storedSelection=localStorage.getItem('mf_selected_unit');
 if(storedSelection&&storedSelection!=='all'&&!units.some(unit=>String(unit.id)===storedSelection)){
  localStorage.setItem('mf_selected_unit','all');
 }
 if(!storedSelection)localStorage.setItem('mf_selected_unit','all');
 localStorage.setItem('mf_report_unit',selectedUnitId());
 if(changed)save();
}
let dataLoaded=false;
let lastClientId=0;
const newClientId=()=>{lastClientId=Math.max(Date.now(),lastClientId+1);return lastClientId};
const syncSnapshot={};
let syncQueue=Promise.resolve();
const numOrNull=v=>{const n=Number(v);return v===''||v==null||Number.isNaN(n)?null:n};
function unitToRow(u){return {id:Number(u.id),name:u.name,location:u.location||'',block:u.block||'',manager:u.manager||'',status:u.status||'Ativo'}}
function unitFromRow(r){return {id:r.id,name:r.name,location:r.location||'',block:r.block||'',manager:r.manager||'',status:r.status||'Ativo'}}
function profileToRow(p){return {id:p.id,name:p.name||'',email:String(p.email||'').toLowerCase(),phone:p.phone||'',photo:p.photo||'',job_title:p.jobTitle||'',registration:p.registration||'',shift:p.shift||'',department:p.department||'',address:p.address||'',unit_id:numOrNull(p.unitId),profile_type:normalizedProfileType(p),status:normalizedProfileStatus(p.status),created_at:p.createdAt||new Date().toISOString()}}
function productToRow(p){return {id:Number(p.id),unit_id:Number(productUnitId(p)),name:p.name,cat:p.cat,qty:Number(p.qty)||0,min_qty:Number(p.min)||0,expiry_date:p.date||null,price:Number(p.price)||0,emoji:p.emoji||'📦'}}
function productFromRow(r){const id=String(r.unit_id);return {id:r.id,name:r.name,cat:r.cat,qty:Number(r.qty),min:Number(r.min_qty),date:r.expiry_date||'',price:Number(r.price),unitId:id,unidade_id:id,emoji:r.emoji||'📦'}}
function txToRow(t){return {id:Number(t.id),created_at:t.createdAt||new Date().toISOString(),description:t.desc||'',type:t.type,value:Number(t.value)||0,forma_pagamento:t.formaPagamento||null,unit_id:numOrNull(productUnitId(t)||t.unitId),product_name:t.product||null,qty:numOrNull(t.qty),reason:t.reason||null,details:t.details||null,employee:t.employee||null,items:t.items||null}}
function txFromRow(r){const id=r.unit_id==null?'':String(r.unit_id);const unit=units.find(item=>String(item.id)===id);const tx={id:r.id,date:new Date(r.created_at).toLocaleDateString('pt-BR'),createdAt:r.created_at,desc:r.description,type:r.type,value:Number(r.value),unitId:id,unidade_id:id,unit:unit?.name||''};if(r.forma_pagamento)tx.formaPagamento=r.forma_pagamento;if(r.product_name)tx.product=r.product_name;if(r.qty!=null)tx.qty=Number(r.qty);if(r.reason)tx.reason=r.reason;if(r.details)tx.details=r.details;if(r.employee)tx.employee=r.employee;if(r.items)tx.items=r.items;return tx}
function taskToRow(t){return {id:Number(t.id),title:t.title,assignee_id:t.assigneeId||null,assignee_name:t.assigneeName||null,completed:Boolean(t.completed),completed_at:t.completedAt||null,completed_by:t.completedBy||null,created_at:t.createdAt||new Date().toISOString()}}
function taskFromRow(r){return {id:r.id,title:r.title,assigneeId:r.assignee_id?String(r.assignee_id):'',assigneeName:r.assignee_name||'',completed:Boolean(r.completed),completedAt:r.completed_at||'',completedBy:r.completed_by||'',createdAt:r.created_at}}
function noticeToRow(n){return {id:Number(n.id),message:n.message,recipient_id:String(n.recipientId??'all'),recipient_name:n.recipientName||null,created_at:n.createdAt||new Date().toISOString()}}
function noticeFromRow(r){return {id:r.id,message:r.message,recipientId:r.recipient_id,recipientName:r.recipient_name||'',createdAt:r.created_at}}
function channelToRow(c){return {id:Number(c.id),unit_id:String(c.unitId??'all'),channel:c.channel||'E-mail',email:c.email||null,phone:c.phone||null}}
function channelFromRow(r){const c={id:r.id,unitId:r.unit_id,channel:r.channel};if(r.email)c.email=r.email;if(r.phone)c.phone=r.phone;return c}
// ordem importa: quem é referenciado vem antes (units -> profiles -> products ...)
const syncTables=[
 {name:'units',get:()=>units,set:v=>{units=v},toRow:unitToRow,fromRow:unitFromRow,order:'id',asc:true,needsId:false},
 {name:'profiles',get:()=>profiles,set:v=>{profiles=v},toRow:profileToRow,fromRow:r=>mapProfileRow(r),order:'created_at',asc:true,needsId:false},
 {name:'products',get:()=>products,set:v=>{products=v},toRow:productToRow,fromRow:productFromRow,order:'id',asc:true,needsId:false},
 {name:'transactions',get:()=>transactions,set:v=>{transactions=v},toRow:txToRow,fromRow:txFromRow,order:'created_at',asc:false,needsId:true},
 {name:'staff_tasks',get:()=>staffTasks,set:v=>{staffTasks=v},toRow:taskToRow,fromRow:taskFromRow,order:'created_at',asc:false,needsId:true},
 {name:'staff_notices',get:()=>staffNotices,set:v=>{staffNotices=v},toRow:noticeToRow,fromRow:noticeFromRow,order:'created_at',asc:false,needsId:true},
 {name:'notification_channels',get:()=>notificationChannelList,set:v=>{notificationChannelList=v},toRow:channelToRow,fromRow:channelFromRow,order:'id',asc:true,needsId:true}
];
syncTables.forEach(table=>{syncSnapshot[table.name]=new Map()});
function rememberSnapshot(tables=syncTables){
 tables.forEach(table=>{
  syncSnapshot[table.name].clear();
  table.get().forEach(item=>{const row=table.toRow(item);syncSnapshot[table.name].set(String(row.id),{json:JSON.stringify(row),id:row.id})});
 });
}
async function loadDataFromSupabase(){
 const results=await Promise.all(syncTables.map(table=>sb.from(table.name).select('*').order(table.order,{ascending:table.asc})));
 results.forEach(result=>{if(result.error)throw result.error});
 syncTables.forEach((table,index)=>table.set(results[index].data.map(table.fromRow)));
 rememberSnapshot();
 ['mf_products_v2','mf_tx_v2','mf_units_v1','mf_profiles_v1','mf_staff_tasks_v1','mf_staff_notices_v1','mf_notification_channels_v1','mf_account'].forEach(key=>localStorage.removeItem(key));
 dataLoaded=true;
 initializeUnitData();
}
async function syncToSupabase(){
 if(!dataLoaded)return;
 syncTables.forEach(table=>{if(table.needsId)table.get().forEach(item=>{if(!item.id)item.id=newClientId()})});
 for(const table of syncTables){
  const changed=table.get().map(table.toRow).filter(row=>{const previous=syncSnapshot[table.name].get(String(row.id));return !previous||previous.json!==JSON.stringify(row)});
  if(changed.length){
   const known=syncSnapshot[table.name];
   const inserts=changed.filter(row=>!known.has(String(row.id)));
   const updates=changed.filter(row=>known.has(String(row.id)));
   if(inserts.length){
    const {error}=await sb.from(table.name).insert(inserts);
    if(error)throw error;
   }
   if(updates.length>20){
    // muitas alterações de uma vez (ex.: importação de planilha): envia em lote
    const {error}=await sb.from(table.name).upsert(updates);
    if(error)throw error;
   }else await Promise.all(updates.map(async row=>{
    const {data,error}=await sb.from(table.name).update(row).eq('id',row.id).select('id');
    if(error)throw error;
    if(!data?.length)throw new Error('Você não tem permissão para alterar este registro.');
   }));
   changed.forEach(row=>known.set(String(row.id),{json:JSON.stringify(row),id:row.id}));
  }
 }
 for(const table of [...syncTables].reverse()){
  const present=new Set(table.get().map(item=>String(item.id)));
  const gone=[...syncSnapshot[table.name].entries()].filter(([key])=>!present.has(key)).map(([,value])=>value.id);
  if(gone.length){
   const {data,error}=await sb.from(table.name).delete().in('id',gone).select('id');
   if(error)throw error;
   if((data?.length||0)<gone.length)throw new Error('Você não tem permissão para excluir este registro.');
   gone.forEach(id=>syncSnapshot[table.name].delete(String(id)));
  }
 }
}
function save(){
 syncQueue=syncQueue.then(syncToSupabase).catch(async error=>{
  console.error('Erro ao salvar no Supabase:',error);
  alert(`Não foi possível salvar no banco de dados: ${error.message||error}`);
  try{await loadDataFromSupabase();render()}catch(reloadError){console.error(reloadError)}
 });
}
// Atualização em tempo real de tarefas e avisos (substitui o antigo evento 'storage')
let realtimeChannel=null,realtimeTimer=null;
function redrawStaffPages(){
 const page=document.querySelector('.nav-item.active')?.dataset.page;
 if(page==='tarefas-equipe'&&isAdmin())drawStaffTaskMonitor();
 else if(page==='dashboard'&&isAdmin())dashboard();
 else if(page==='dashboard'&&isStaffProfile())staffDashboard();
 else if(page==='tarefas'&&isStaffProfile())tasksPage();
}
async function refreshStaffData(){
 if(!dataLoaded)return;
 await syncQueue;
 const staffSyncTables=syncTables.filter(table=>['staff_tasks','staff_notices'].includes(table.name));
 const results=await Promise.all(staffSyncTables.map(table=>sb.from(table.name).select('*').order(table.order,{ascending:table.asc})));
 if(results.some(result=>result.error))return;
 staffSyncTables.forEach((table,index)=>table.set(results[index].data.map(table.fromRow)));
 rememberSnapshot(staffSyncTables);
 redrawStaffPages();
}
function subscribeRealtime(){
 if(realtimeChannel)return;
 const schedule=()=>{clearTimeout(realtimeTimer);realtimeTimer=setTimeout(refreshStaffData,400)};
 realtimeChannel=sb.channel('mf-staff')
  .on('postgres_changes',{event:'*',schema:'public',table:'staff_tasks'},schedule)
  .on('postgres_changes',{event:'*',schema:'public',table:'staff_notices'},schedule)
  .subscribe();
}
function unsubscribeRealtime(){if(realtimeChannel){sb.removeChannel(realtimeChannel);realtimeChannel=null}}
function unitOptions(selected='all',includeAll=true){
 const options=includeAll?`<option value="all" ${selected==='all'?'selected':''}>Todas as unidades</option>`:'';
 return `${options}${units.map(unit=>`<option value="${escapeHTML(String(unit.id))}" ${selected===String(unit.id)?'selected':''}>${escapeHTML(unit.name)}</option>`).join('')}`;
}
function updateUnitSelector(){
 const selector=$('#unitSelector');
 if(!selector)return;
 selector.innerHTML=units.length?unitOptions(selectedUnitId()):'<option value="" selected>Nenhuma unidade cadastrada</option>';
 selector.disabled=!units.length;
}
function initializeUnitData(){migrateProductUnits();updateUnitSelector()}
initializeUnitData();
function daysTo(date){return Math.ceil((new Date(date+'T00:00:00')-new Date(today.toISOString().slice(0,10)+'T00:00:00'))/86400000)}
function status(p){const d=daysTo(p.date);if(d<0)return ['Vencido','danger'];if(d<=3)return ['Urgente','danger'];if(d<=7)return ['Próximo','warn'];if(p.qty<=p.min)return ['Estoque baixo','warn'];return ['Normal','']}
function pageHeader(title,sub){$('#pageTitle').textContent=title;$('#pageSub').textContent=sub}
function normalizedProfileType(profile){
 const type=String(profile?.profileType||profile?.role||'operator').toLowerCase();
 if(['admin','adm','owner'].includes(type))return 'admin';
 if(['manager','gerente'].includes(type))return 'manager';
 if(['stock','estoquista'].includes(type))return 'stock';
 return 'operator';
}
function profileTypeLabel(type){
 return ({admin:'ADM',manager:'Gerente',operator:'Funcionário',stock:'Estoquista'})[type]||'Funcionário';
}
function normalizedProfileStatus(value){
 const status=String(value||'active').toLowerCase();
 return ['active','inactive','blocked','pending','deleted'].includes(status)?status:'active';
}
function profileStatusLabel(value){
 return ({active:'Ativo',inactive:'Inativo',blocked:'Bloqueado',pending:'Pendente',deleted:'Excluído'})[normalizedProfileStatus(value)];
}
function isProfileActive(profile){return normalizedProfileStatus(profile?.status)==='active'}
function profileAvatarMarkup(profile,sizeClass=''){
 const initials=escapeHTML((profile?.name||'?').split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase());
 return `<span class="profile-avatar ${sizeClass}">${profile?.photo?`<img src="${escapeHTML(profile.photo)}" alt="">`:initials}</span>`;
}
function setUserAvatar(element,profile,initials){
 if(profile?.photo){
  const image=document.createElement('img');
  image.src=profile.photo;
  image.alt='';
  image.className='user-avatar-photo';
  element.replaceChildren(image);
 }else{
  element.textContent=initials;
 }
}
function updateProfilePhotoPreview(photo){
 const preview=$('#profilePhotoPreview');
 preview.src=photo||'';
 preview.classList.toggle('hidden',!photo);
 $('#removeProfilePhoto').classList.toggle('hidden',!photo);
}
function readProfilePhoto(file){
 return new Promise((resolve,reject)=>{
  if(!file.type.match(/^image\/(jpeg|png|webp)$/)){reject(new Error('Escolha uma imagem JPG, PNG ou WebP.'));return}
  if(file.size>5*1024*1024){reject(new Error('A imagem deve ter no máximo 5 MB.'));return}
  const reader=new FileReader();
  reader.onerror=()=>reject(new Error('Não foi possível ler a imagem selecionada.'));
  reader.onload=()=>{
   const image=new Image();
   image.onerror=()=>reject(new Error('O arquivo selecionado não contém uma imagem válida.'));
   image.onload=()=>{
    const scale=Math.min(1,512/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');
    if(!context){reject(new Error('Não foi possível processar a imagem selecionada.'));return}
    context.drawImage(image,0,0,canvas.width,canvas.height);
    resolve(canvas.toDataURL('image/jpeg',0.82));
   };
   image.src=String(reader.result);
  };
  reader.readAsDataURL(file);
 });
}
function persistProfiles(){save()}
function initializeProfiles(){
 const account=JSON.parse(localStorage.getItem(authAccountKey)||'null');
 if(!profiles.length&&account?.email){
  profiles=[{...account,id:'admin-root',phone:account.phone||'',jobTitle:account.jobTitle||'Administrador',profileType:account.role?normalizedProfileType(account):'admin',status:'active',createdAt:account.createdAt||new Date().toISOString()}];
  persistProfiles();
 }
 profiles=profiles.map(profile=>({...profile,profileType:normalizedProfileType(profile),status:normalizedProfileStatus(profile.status),createdAt:profile.createdAt||new Date().toISOString()}));
}
initializeProfiles();
function isAdmin(){return isProfileActive(currentUser)&&normalizedProfileType(currentUser)==='admin'}
function escapeHTML(value){
 return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function profilePermissions(type){
 const pages=type==='admin'
  ?['Dashboard','Estoque','Validade','Financeiro','Unidades','Relatórios','Gerenciar Perfis','Acompanhar Tarefas','Configurações']
  :type==='manager'
   ?['Dashboard','Estoque','Validade','Financeiro','Unidades','Configurações']
   :type==='stock'
      ?['Dashboard','Estoque','Validade','Registrar perda','Minhas tarefas','Configurações']
     :['Dashboard','Estoque','Validade','Registrar perda','Minhas tarefas','Configurações'];
 return pages;
}
function canAccessPage(page){
 if(page==='perfis'||page==='relatorios'||page==='tarefas-equipe')return isAdmin();
 return profilePermissions(normalizedProfileType(currentUser)).some(label=>({
  Dashboard:'dashboard',Estoque:'estoque',Validade:'validade','Registrar perda':'perda','Minhas tarefas':'tarefas',Financeiro:'financeiro',Unidades:'unidades',Configurações:'config'
 })[label]===page);
}
function isStaffProfile(profile=currentUser){return ['operator','stock'].includes(normalizedProfileType(profile))}
function reportDate(value){
 const text=String(value||'');
 const match=text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
 if(match)return new Date(`${match[3]}-${match[2]}-${match[1]}T12:00:00`);
 const date=new Date(text);
 return Number.isNaN(date.getTime())?null:date;
}
function reportRange(){
 return reportRangeFor(currentReportPeriod());
}
function currentReportPeriod(){
 const value=$('#reportPeriod')?.value||localStorage.getItem('mf_report_period')||'7';
 return ['today','7','30'].includes(value)?value:'7';
}
function transactionDateTime(transaction){
 const timestamp=transaction.createdAt?new Date(transaction.createdAt):reportDate(transaction.date);
 return timestamp&&!Number.isNaN(timestamp.getTime())?timestamp:null;
}
function reportTransactions(){
 const range=reportRange();
 return transactions.filter(transaction=>{const date=transactionDateTime(transaction);return date&&date>=range.start&&date<=range.end&&matchesSelectedUnit(transaction)})
}
function reportMoney(value){return money(Number(value)||0)}
function reportEmpty(message){return `<div class="report-empty">${message}</div>`}
function resumoPagamentos(pontoDeVenda=selectedUnitId(),periodo=currentReportPeriod()){
 const range=reportRangeFor(periodo);
 const methods=[
  {name:'Pix',key:'pix',value:0,sales:0},
  {name:'Crédito',key:'credito',value:0,sales:0},
  {name:'Débito',key:'debito',value:0,sales:0},
  {name:'Voucher',key:'voucher',value:0,sales:0}
 ];
 transactions.forEach(transaction=>{
  if(transaction.type!=='Saída')return;
  const payment=methods.find(method=>method.name===transaction.formaPagamento);
  const date=transactionDateTime(transaction);
  if(!payment||!date||date<range.start||date>range.end)return;
  if(pontoDeVenda!=='all'&&!matchesSpecificUnit(transaction,pontoDeVenda))return;
  payment.sales++;
  payment.value+=Math.abs(Number(transaction.value)||0);
 });
 const total=methods.reduce((sum,method)=>sum+method.value,0);
 const count=methods.reduce((sum,method)=>sum+method.sales,0);
 methods.forEach(method=>method.percent=total?method.value/total*100:0);
 const mostUsed=methods.reduce((best,method)=>method.value>best.value?method:best,{name:'—',value:0,percent:0});
 return {methods,total,count,mostUsed:total?mostUsed:{name:'—',value:0,percent:0}};
}
function reportRangeFor(periodo){
 const end=new Date();end.setHours(23,59,59,999);
 const start=new Date(end);
 if(periodo==='today')start.setHours(0,0,0,0);
 else start.setDate(start.getDate()-(periodo==='30'?29:6));
 return {start,end};
}
function matchesSpecificUnit(transaction,unitId){
 const unit=units.find(item=>String(item.id)===String(unitId));
 return String(transaction.unitId||transaction.unidade_id||'')===String(unitId)||
  Boolean(unit&&normalizedUnitName(transaction.unit)===normalizedUnitName(unit.name));
}
let resetMode='request';
function setResetFieldsVisible({email,code,password}){
 ['#resetEmail','label[for="resetEmail"]'].forEach(sel=>$(sel).classList.toggle('hidden',!email));
 ['#resetCode','label[for="resetCode"]'].forEach(sel=>$(sel).classList.toggle('hidden',!code));
 $('#resetVerification').classList.toggle('hidden',!(code||password));
 $('#resetEmail').required=email;
 $('#newPassword').required=password;
 $('#newPassword').minLength=6;
}
function openResetModal(){
 resetMode='request';
 $('#resetModal').classList.remove('hidden');$('#resetForm').reset();
 setResetFieldsVisible({email:true,code:false,password:false});
 $('#resetIntro').textContent='Informe o e-mail da sua conta para receber um link de redefinição de senha.';
 $('#resetEmail').disabled=false;$('#resetSubmit').disabled=false;$('#resetSubmit').textContent='Enviar link';$('#resetMessage').textContent='';
}
function openRecoveryModal(){
 resetMode='recovery';
 $('#resetModal').classList.remove('hidden');$('#resetForm').reset();
 setResetFieldsVisible({email:false,code:false,password:true});
 $('#resetIntro').textContent='Digite a sua nova senha (mínimo de 6 caracteres).';
 $('#resetSubmit').disabled=false;$('#resetSubmit').textContent='Salvar nova senha';$('#resetMessage').textContent='';
}
async function resetPasswordFlow(event){
 event.preventDefault();
 const message=$('#resetMessage'),button=$('#resetSubmit');
 if(resetMode==='request'){
  const email=$('#resetEmail').value.trim().toLowerCase();
  button.disabled=true;message.textContent='Enviando...';
  const redirectTo=window.location.href.split('#')[0].split('?')[0];
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo});
  button.disabled=false;
  if(error){message.textContent=(error.status===429||/rate limit/i.test(error.message))?'Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente de novo.':`Não foi possível enviar o e-mail: ${error.message}`;return}
  message.textContent='Se este e-mail estiver cadastrado, enviamos um link para redefinir a senha. Confira também a caixa de spam.';
  return;
 }
 const newPassword=$('#newPassword').value;
 if(newPassword.length<6){message.textContent='A nova senha precisa ter pelo menos 6 caracteres.';return}
 button.disabled=true;message.textContent='Salvando...';
 const {error}=await sb.auth.updateUser({password:newPassword});
 button.disabled=false;
 if(error){message.textContent=/session/i.test(error.message)?'O link expirou ou já foi usado. Feche esta janela e peça um novo link em “Esqueci minha senha”.':`Não foi possível salvar a senha: ${error.message}`;return}
 await sb.auth.signOut();
 history.replaceState(null,'',window.location.pathname);
 $('#resetModal').classList.add('hidden');
 $('#authMessage').textContent='Senha redefinida. Entre com a nova senha.';
 $('#password').value='';
}
function reportFilteredProducts(){
 return products.filter(matchesSelectedUnit);
}
function reportMetrics(){
 const filtered=reportTransactions(); const sales=filtered.filter(t=>t.type==='Entrada'); const revenue=sales.reduce((sum,t)=>sum+Math.abs(Number(t.value)||0),0); const losses=reportFilteredProducts().filter(product=>daysTo(product.date)<0).reduce((sum,product)=>sum+(Number(product.qty)||0),0); const stockTotal=reportFilteredProducts().reduce((sum,product)=>sum+(Number(product.qty)||0),0);
 const payments=['Pix','Crédito','Débito'].map(payment=>({name:payment,value:sales.filter(t=>t.payment===payment).reduce((sum,t)=>sum+Math.abs(Number(t.value)||0),0)}));
 return {filtered,sales,revenue,average:sales.length?revenue/sales.length:0,lossRate:stockTotal?losses/stockTotal*100:0,payments};
}
function reportFileDate(){return new Date().toISOString().slice(0,10)}
function reportFileName(name,extension){return `relatorio_${name}_${reportFileDate()}.${extension}`}
function reportFilterLabel(selector, fallback){return $(selector)?.selectedOptions?.[0]?.textContent||fallback}
function reportWorkbookData(name,rows){
 const metrics=reportMetrics();
 const period=reportFilterLabel('#reportPeriod',reportPeriodLabel(currentReportPeriod()));
 const unit=selectedUnitId()==='all'?'Todas as unidades':selectedUnitName();
 const headers=name==='vendas_faturamento'||name==='formas_de_pagamento'?['Data','Ponto de Venda','Categoria','Produto','Valor','Forma de Pagamento']:name==='giro_estoque_abc'?['Produto','Categoria','Quantidade','Preço','Status']:name==='necessidade_reposicao'?['Produto','Categoria','Quantidade Atual','Estoque Mínimo']:name==='auditoria_quebras'?['Produto','Quantidade','Motivo']:['Data','Horário','Valor','Descrição'];
 const dataRows=name==='vendas_faturamento'||name==='formas_de_pagamento'?metrics.filtered.map(transaction=>[transaction.date,transaction.unit||'Sem unidade',transaction.category||'',transaction.product||transaction.desc||'',Math.abs(Number(transaction.value)||0),transaction.formaPagamento||transaction.payment||'']):rows;
 const paymentSummary=resumoPagamentos(selectedUnitId(),currentReportPeriod());
 const reportSheet=[['Relatórios'],['Indicadores administrativos para tomada de decisão'],[],['Período','Ponto de Venda'],[period,unit],[],['FATURAMENTO BRUTO','TICKET MÉDIO','TAXA DE QUEBRA/PERDAS','MÉTODOS DE PAGAMENTO'],[metrics.revenue,metrics.average,`${metrics.lossRate.toFixed(1)}%`,'Pix | Crédito | Débito | Voucher'],[],['Método','Valor'],...metrics.payments.map(payment=>[payment.name,payment.value]),[],['Formas de pagamento'],['Forma de pagamento','Nº de vendas','Valor recebido (R$)','% do total'],...paymentSummary.methods.map(method=>[method.name,method.sales,method.value,paymentSummary.total?method.value/paymentSummary.total:0]),['Total',paymentSummary.count,paymentSummary.total,paymentSummary.total?1:0]];
 return {dataSheet:[headers,...dataRows],reportSheet,paymentHeaderRow:16,paymentFirstRow:17,paymentLastRow:21};
}
function downloadReportFile(name,extension,rows){
 if(extension==='xlsx'&&window.XLSX){
  const workbookData=reportWorkbookData(name,rows);
  const dataSheet=XLSX.utils.aoa_to_sheet(workbookData.dataSheet);
  const reportSheet=XLSX.utils.aoa_to_sheet(workbookData.reportSheet);
  const dataColumnCount=workbookData.dataSheet[0].length;
  const dataLastColumn=XLSX.utils.encode_col(dataColumnCount-1);
  dataSheet['!cols']=[{wch:18},{wch:24},{wch:22},{wch:28},{wch:15},{wch:22}];
  dataSheet['!autofilter']={ref:`A1:${dataLastColumn}${Math.max(workbookData.dataSheet.length,1)}`};
  reportSheet['!cols']=[{wch:28},{wch:20},{wch:24},{wch:18}];
  reportSheet['!merges']=[{s:{r:0,c:0},e:{r:0,c:3}},{s:{r:1,c:0},e:{r:1,c:3}}];
  reportSheet['!autofilter']={ref:`A${workbookData.paymentHeaderRow}:D${workbookData.paymentLastRow}`};
  for(let row=workbookData.paymentFirstRow;row<=workbookData.paymentLastRow;row++){
   const amountCell=reportSheet[`C${row}`];
   const percentCell=reportSheet[`D${row}`];
   if(amountCell)amountCell.z='"R$" #,##0.00';
   if(percentCell)percentCell.z='0.0%';
  }
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,dataSheet,'Dados');
  XLSX.utils.book_append_sheet(workbook,reportSheet,'Relatório');
  XLSX.writeFile(workbook,reportFileName(name,'xlsx'));
  return;
 }
 if(extension==='xlsx'){alert('Não foi possível carregar o recurso de exportação XLSX. Recarregue a página e tente novamente.');return}
 const content=rows.map(row=>row.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(';')).join('\n'); const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));link.download=reportFileName(name,'csv');link.click();URL.revokeObjectURL(link.href);
}
function reportRows(kind){
 const metrics=reportMetrics();
 if(kind==='vendas')return metrics.filtered.map(t=>[t.date,t.desc,t.type,t.payment||'',t.value,t.unit||'']);
 if(kind==='estoque')return reportFilteredProducts().map(p=>[p.name,p.cat,p.qty,p.price,p.qty<=p.min?'Abaixo do mínimo':'Normal']);
 if(kind==='reposicao')return reportFilteredProducts().filter(p=>p.qty<=p.min).map(p=>[p.name,p.cat,p.qty,p.min]);
 if(kind==='quebras')return reportFilteredProducts().filter(p=>daysTo(p.date)<0).map(p=>[p.name,p.qty,'Vencido']);
 return metrics.filtered.map(t=>[t.date,t.createdAt||'',t.value,t.desc]);
}
function exportReportFile(kind,format,button){
 if(button.closest('.report-toolbar-actions'))format='xlsx';
 button.disabled=true; const original=button.textContent; button.textContent='Gerando...';
 setTimeout(()=>{const labels={vendas:'vendas_faturamento',estoque:'giro_estoque_abc',reposicao:'necessidade_reposicao',quebras:'auditoria_quebras',consumo:'perfil_consumo'}; const rows=reportRows(kind); const content=[['Relatório',labels[kind]],...rows].map(row=>row.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(';')).join('\n');
  if(format==='pdf'){const target=button.closest('.report-card');target?.classList.add('print-target');document.body.classList.add('printing-report');window.print();window.setTimeout(()=>{document.body.classList.remove('printing-report');target?.classList.remove('print-target')},500)} else downloadReportFile(labels[kind],'xlsx',rows);
  button.disabled=false;button.textContent=original;
 },450);
}
function reportPeriodLabel(period){
 return ({today:'Hoje','7':'Últimos 7 dias','30':'Últimos 30 dias'})[period]||'Últimos 7 dias';
}
function reportChanged(){
 const period=$('#reportPeriod')?.value||'7';
 localStorage.setItem('mf_report_period',period);
 renderPaymentsReport();
}
function reportPage(){
 if(!isAdmin()){go('dashboard');return}
 pageHeader('Relatórios','Formas de pagamento recebidas no período');
 renderPaymentsReport();
}
function renderPaymentsReport(){
 const period=currentReportPeriod();
 const selectedUnit=selectedUnitId();
 const summary=resumoPagamentos(selectedUnit,period);
 const mostUsed=summary.mostUsed;
 let chartOffset=0;
 const chartStops=summary.methods.map(method=>{
  const start=chartOffset;
  chartOffset+=method.percent;
  return `var(--payment-${method.key}) ${start}% ${chartOffset}%`;
 }).join(',');
 const chartBackground=summary.total?`conic-gradient(${chartStops})`:'conic-gradient(#edf1ee 0 100%)';
 $('#content').innerHTML=`<div class="page report-page" id="reportDocument">
  <div class="report-toolbar">
   <div><h1 class="report-title">Relatórios</h1><p class="muted">Formas de pagamento recebidas no período</p></div>
   <button class="primary report-action" type="button" onclick="exportPaymentReport(this)">⇩ &nbsp; Exportar relatório (.xlsx)</button>
  </div>
  <section class="panel report-filters">
   <div><label for="reportPeriod">Período</label><select id="reportPeriod" class="filter-select" onchange="reportChanged()">
    <option value="today" ${period==='today'?'selected':''}>Hoje</option>
    <option value="7" ${period==='7'?'selected':''}>Últimos 7 dias</option>
    <option value="30" ${period==='30'?'selected':''}>Últimos 30 dias</option>
   </select></div>
  </section>
  <div class="metric-grid report-kpis payment-report-kpis">
   <div class="metric"><span>Total recebido</span><strong>${reportMoney(summary.total)}</strong></div>
   <div class="metric"><span>Vendas realizadas</span><strong>${summary.count}</strong></div>
   <div class="metric"><span>Forma mais usada</span><strong>${escapeHTML(mostUsed.name)}</strong><small>${summary.total?`${mostUsed.percent.toLocaleString('pt-BR',{maximumFractionDigits:1})}% do total`:'0% do total'}</small></div>
  </div>
  <section class="panel report-payment-panel">
   <h3>Formas de pagamento</h3>
   <div class="payment-breakdown">
    <div class="payment-mini-chart" role="img" aria-label="Gráfico de participação percentual das formas de pagamento" style="--payment-chart:${chartBackground}">
     <div class="payment-mini-chart-center"><strong>${summary.total?`${Math.round(summary.methods.reduce((sum,method)=>sum+method.percent,0))}%`:'0%'}</strong><span>do total</span></div>
    </div>
    <div class="payment-method-bars">${summary.methods.map(method=>`<div class="payment-method-item">
    <div class="payment-method-label"><b class="payment-method-name ${method.key}">${escapeHTML(method.name)}</b><span>${method.sales} ${method.sales===1?'venda':'vendas'} · ${method.percent.toLocaleString('pt-BR',{maximumFractionDigits:1})}%</span><strong>${reportMoney(method.value)}</strong></div>
    <div class="payment-method-track" role="progressbar" aria-label="${escapeHTML(method.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${method.percent.toFixed(1)}"><i class="payment-progress-fill ${method.key}" style="width:${method.percent}%"></i></div>
   </div>`).join('')}${summary.count?'':reportEmpty('Nenhuma venda no período.')}</div>
   </div>
  </section>
 </div>`;
}
function exportPaymentReport(button){
 button.disabled=true;
 const original=button.textContent;
 button.textContent='Gerando...';
 try{
  downloadReportFile('formas_de_pagamento','xlsx',reportRows('vendas'));
 }finally{
  button.disabled=false;
  button.textContent=original;
 }
}
function profilePage(){
 if(!isAdmin()){go('dashboard');return}
 selectedProfileId=null;
 pageHeader('Gerenciar Perfis','Cadastre e administre os acessos da equipe');
 $('#content').innerHTML=`<div class="page profiles-page"><div class="report-toolbar"><div><h1 class="report-title">Perfis da equipe</h1><p class="muted">Gerencie funcionários, funções e permissões de acesso.</p></div><button class="primary" type="button" onclick="openProfileForm()">+ Novo perfil</button></div><section class="panel profile-filters"><label class="profile-search"><span>⌕</span><input id="profileSearch" type="search" placeholder="Buscar por nome ou e-mail" oninput="renderProfiles()"></label><select id="profileTypeFilter" class="filter-select" aria-label="Filtrar por tipo de perfil" onchange="renderProfiles()"><option value="all">Todos os perfis</option><option value="admin">ADM</option><option value="manager">Gerente</option><option value="operator">Funcionário</option></select><select id="profileJobTitleFilter" class="filter-select" aria-label="Filtrar por cargo" onchange="renderProfiles()"><option value="all">Todos os cargos</option><option value="caixa">Caixa</option><option value="estoquista">Estoquista</option><option value="função">Função</option></select><select id="profileStatusFilter" class="filter-select" aria-label="Filtrar por status" onchange="renderProfiles()"><option value="all">Todos os status</option><option value="active">Ativo</option><option value="inactive">Inativo</option><option value="blocked">Bloqueado</option><option value="pending">Pendente</option><option value="deleted">Excluído</option></select></section><div id="profileList" class="profile-list"></div><p class="muted profile-storage-note">Os dados desta demonstração são salvos somente neste navegador. Para proteção real de contas e permissões, conecte um backend com autenticação.</p></div>`;
 renderProfiles();
}
function renderProfiles(){
 const list=$('#profileList'); if(!list)return;
 const query=($('#profileSearch')?.value||'').trim().toLowerCase();
 const type=$('#profileTypeFilter')?.value||'all';
 const jobTitle=$('#profileJobTitleFilter')?.value||'all';
 const statusFilter=$('#profileStatusFilter')?.value||'all';
 const filtered=profiles.filter(profile=>{
  const matchesQuery=`${profile.name||''} ${profile.email||''}`.toLowerCase().includes(query);
  const matchesJobTitle=jobTitle==='all'||String(profile.jobTitle||'').trim().toLowerCase()===jobTitle;
  return matchesQuery&&matchesJobTitle&&(type==='all'||normalizedProfileType(profile)===type)&&(statusFilter==='all'||normalizedProfileStatus(profile.status)===statusFilter);
 });
 list.innerHTML=`<div class="table-wrap"><table class="table profiles-table"><thead><tr><th>Funcionário</th><th>Cargo / função</th><th>Perfil</th><th>Status</th><th>Cadastro</th></tr></thead><tbody>${filtered.length?filtered.map(profile=>{const profileStatus=normalizedProfileStatus(profile.status);return `<tr class="profile-list-row" tabindex="0" role="button" aria-label="Ver perfil de ${escapeHTML(profile.name)}" onclick="openProfileDetails('${encodeURIComponent(String(profile.id))}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openProfileDetails('${encodeURIComponent(String(profile.id))}')}"><td><div class="profile-person">${profileAvatarMarkup(profile)}<span><b>${escapeHTML(profile.name||'Sem nome')}</b><small>${escapeHTML(profile.email||'')}</small></span></div></td><td>${escapeHTML(profile.jobTitle||'—')}</td><td><span class="profile-type-badge">${profileTypeLabel(normalizedProfileType(profile))}</span></td><td><span class="status ${profileStatus==='active'?'':'danger'}">${profileStatusLabel(profileStatus)}</span></td><td>${profile.createdAt?new Date(profile.createdAt).toLocaleDateString('pt-BR'):'—'}</td></tr>`}).join(''):'<tr><td colspan="5" class="empty-cell">Nenhum perfil encontrado.</td></tr>'}</tbody></table></div>`;
}
function openProfileDetails(encodedId){
 if(!isAdmin()){go('dashboard');return}
 const id=decodeURIComponent(encodedId);
 const profile=profiles.find(item=>String(item.id)===id);
 if(!profile){alert('Este perfil não foi encontrado.');go('perfis');return}
 selectedProfileId=id;
 pageHeader(profile.name,'Detalhes do funcionário');
 document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.page==='perfis'));
 const type=normalizedProfileType(profile);
 const profileStatus=normalizedProfileStatus(profile.status);
 const permissions=profilePermissions(type);
 const isSelf=String(currentUser?.id)===String(profile.id);
 $('#content').innerHTML=`<div class="page profiles-page"><button class="back-link" type="button" onclick="go('perfis')">← Voltar para perfis</button><section class="panel profile-detail-card"><div class="profile-detail-header"><div class="profile-person profile-detail-person">${profileAvatarMarkup(profile)}<div><h1>${escapeHTML(profile.name||'Sem nome')}</h1><span class="profile-type-badge">${profileTypeLabel(type)}</span> <span class="status ${profileStatus==='active'?'':'danger'}">${profileStatusLabel(profileStatus)}</span></div></div><div class="profile-detail-actions"><button class="secondary" type="button" onclick="openProfileForm('${encodeURIComponent(String(profile.id))}')">Editar</button><button class="${profileStatus==='active'?'danger-button':'secondary'}" type="button" onclick="toggleProfileStatus('${encodeURIComponent(String(profile.id))}')">${profileStatus==='active'?'Desativar':'Reativar'}</button></div></div><dl class="profile-details-grid"><div><dt>E-mail</dt><dd>${escapeHTML(profile.email||'—')}</dd></div><div><dt>Telefone</dt><dd>${escapeHTML(profile.phone||'Não informado')}</dd></div><div><dt>Cargo / função</dt><dd>${escapeHTML(profile.jobTitle||'Não informado')}</dd></div><div><dt>Tipo de perfil</dt><dd>${profileTypeLabel(type)}</dd></div><div><dt>Status</dt><dd>${profileStatusLabel(profileStatus)}</dd></div><div><dt>Data de cadastro</dt><dd>${profile.createdAt?new Date(profile.createdAt).toLocaleString('pt-BR'):'Não informada'}</dd></div></dl><section class="profile-permissions"><h2>Permissões de acesso</h2><p class="muted">Menus disponíveis para este tipo de perfil.</p><ul>${permissions.map(permission=>`<li>${escapeHTML(permission)}</li>`).join('')}</ul></section>${isSelf?'<p class="profile-self-note">Este é seu próprio perfil. Não é permitido alterar seu tipo de acesso nem desativar a conta atual.</p>':''}</section></div>`;
}
function openProfileForm(encodedId=''){
 if(!isAdmin()){alert('Somente um administrador pode gerenciar perfis.');return}
 const profile=encodedId?profiles.find(item=>String(item.id)===decodeURIComponent(encodedId)):null;
 if(encodedId&&!profile){alert('Este perfil não foi encontrado.');return}
 editingProfileId=profile?String(profile.id):null;
 pendingProfilePhoto=profile?.photo||'';
 $('#profileForm').reset();
 $('#profileFormMessage').textContent='';
 $('#profileModalTitle').textContent=profile?'Editar perfil':'Novo perfil';
 $('#profileName').value=profile?.name||'';
 $('#profileEmail').value=profile?.email||'';
 $('#profilePhone').value=profile?.phone||'';
 $('#profilePhoto').value='';
 updateProfilePhotoPreview(pendingProfilePhoto);
 const jobTitleSelect=$('#profileJobTitle');
 jobTitleSelect.innerHTML='<option value="">Selecione o cargo</option><option value="Caixa">Caixa</option><option value="Estoquista">Estoquista</option><option value="Função">Função</option>';
 const existingJobTitle=String(profile?.jobTitle||'');
 if(existingJobTitle&&!Array.from(jobTitleSelect.options).some(option=>option.value===existingJobTitle)){
  jobTitleSelect.add(new Option(existingJobTitle,existingJobTitle));
 }
 jobTitleSelect.value=existingJobTitle;
 $('#profileRegistration').value=profile?.registration||'';
 $('#profileShift').value=profile?.shift||'';
 $('#profileDepartment').value=profile?.department||'';
 $('#profileUnit').innerHTML='<option value="">Sem unidade associada</option>'+units.map(unit=>`<option value="${escapeHTML(String(unit.id))}">${escapeHTML(unit.name)}</option>`).join('');
 $('#profileUnit').value=units.some(unit=>String(unit.id)===String(profile?.unitId||''))?String(profile.unitId):'';
 const typeSelect=$('#profileType');
 typeSelect.innerHTML='<option value="">Selecione o perfil</option><option value="admin">ADM</option><option value="manager">Gerente</option><option value="operator">Funcionário</option>';
 const existingType=profile?normalizedProfileType(profile):'';
 if(existingType&&!Array.from(typeSelect.options).some(option=>option.value===existingType)){
  typeSelect.add(new Option(profileTypeLabel(existingType),existingType));
 }
 typeSelect.value=existingType;
 $('#profileStatus').value=normalizedProfileStatus(profile?.status);
 $('#profilePassword').required=!profile;
 $('#profilePassword').value='';
 $('#profilePasswordHint').textContent=profile?'Deixe a senha em branco para manter a senha atual.':'A senha inicial deve ter pelo menos 6 caracteres.';
 const isSelf=profile&&String(currentUser?.id)===String(profile.id);
 $('#profileType').disabled=Boolean(isSelf);
 $('#profileStatus').disabled=Boolean(isSelf);
 $('#profileModal').classList.remove('hidden');
}
async function saveProfile(event){
 event.preventDefault();
 if(!isAdmin()){alert('Somente um administrador pode gerenciar perfis.');return}
 const email=$('#profileEmail').value.trim().toLowerCase();
 const duplicate=profiles.some(profile=>String(profile.email||'').toLowerCase()===email&&String(profile.id)!==String(editingProfileId));
 if(duplicate){$('#profileFormMessage').textContent='Já existe um perfil cadastrado com este e-mail.';return}
 const existing=profiles.find(profile=>String(profile.id)===String(editingProfileId));
 const newPassword=$('#profilePassword').value;
 if(!existing&&newPassword.length<6){$('#profileFormMessage').textContent='A senha inicial precisa ter pelo menos 6 caracteres.';return}
 const selectedType=$('#profileType').value;
 if(!['admin','manager','operator'].includes(selectedType)&&(!existing||selectedType!==normalizedProfileType(existing))){$('#profileFormMessage').textContent='Selecione ADM, Gerente ou Funcionário como tipo de perfil.';return}
 const isSelf=existing&&String(currentUser?.id)===String(existing.id);
 const requestedStatus=normalizedProfileStatus($('#profileStatus').value);
 if(existing&&normalizedProfileType(existing)==='admin'&&isProfileActive(existing)&&requestedStatus!=='active'&&profiles.filter(item=>normalizedProfileType(item)==='admin'&&isProfileActive(item)).length<=1){$('#profileFormMessage').textContent='Não é possível alterar o status do último perfil ADM ativo.';return}
 const data={name:$('#profileName').value.trim(),email,phone:$('#profilePhone').value.trim(),photo:pendingProfilePhoto,jobTitle:$('#profileJobTitle').value.trim(),registration:$('#profileRegistration').value.trim(),shift:$('#profileShift').value.trim(),unitId:$('#profileUnit').value,department:$('#profileDepartment').value.trim(),profileType:isSelf?normalizedProfileType(existing):selectedType,status:isSelf?existing.status:requestedStatus};
 if(existing&&newPassword){
  if(!isSelf){$('#profileFormMessage').textContent='A senha de outro usuário não pode ser alterada por aqui. Deixe o campo de senha em branco.';return}
  const {error:passwordError}=await sb.auth.updateUser({password:newPassword});
  if(passwordError){$('#profileFormMessage').textContent=`Não foi possível alterar a senha: ${passwordError.message}`;return}
 }
 if(existing){
  Object.assign(existing,data);
  if(String(currentUser?.id)===String(existing.id)){
   currentUser={...existing};
   localStorage.setItem('mf_current_user',JSON.stringify(currentUser));
   $('#userName').textContent=currentUser.name;
   $('#userEmail').textContent=currentUser.email;
   setUserAvatar($('#userAvatar'),currentUser,currentUser.name.charAt(0).toUpperCase());
   setUserAvatar($('#topbarAvatar'),currentUser,currentUser.name.split(/\s+/).slice(0,2).map(part=>part.charAt(0)).join('').toUpperCase());
  }
 }else{
  $('#profileFormMessage').textContent='Criando acesso...';
  const authClient=supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const {data:created,error:signUpError}=await authClient.auth.signUp({email,password:newPassword});
  if(signUpError||!created?.user||!created.user.identities?.length){$('#profileFormMessage').textContent=signUpError?`Não foi possível criar o acesso: ${signUpError.message}`:'Este e-mail já possui um acesso cadastrado.';return}
  profiles.push({id:created.user.id,...data,createdAt:new Date().toISOString()});
 }
 persistProfiles();
 $('#profileModal').classList.add('hidden');
 if(selectedProfileId){openProfileDetails(encodeURIComponent(selectedProfileId));return}
 renderProfiles();
}
function toggleProfileStatus(encodedId){
 if(!isAdmin()){alert('Somente um administrador pode gerenciar perfis.');return}
 const id=decodeURIComponent(encodedId);
 const profile=profiles.find(item=>String(item.id)===id);
 if(!profile){alert('Este perfil não foi encontrado.');return}
 if(String(currentUser?.id)===id){alert('Não é possível desativar o próprio perfil enquanto estiver conectado.');return}
 const nextStatus=isProfileActive(profile)?'inactive':'active';
 if(nextStatus!=='active'&&normalizedProfileType(profile)==='admin'&&profiles.filter(item=>normalizedProfileType(item)==='admin'&&isProfileActive(item)).length<=1){alert('Não é possível alterar o status do último perfil ADM ativo.');return}
 if(!confirm(`${nextStatus==='active'?'Reativar':'Desativar'} o perfil de ${profile.name}?`))return;
 profile.status=nextStatus;
 persistProfiles();
 openProfileDetails(encodeURIComponent(id));
}
function render(){
 const page=document.querySelector('.nav-item.active')?.dataset.page||'dashboard';
 if(page!=='validade')activeExpiryCategory='';
 updateUnitSelector();
 const employee=isStaffProfile();
 $('#app').classList.toggle('employee-app',employee);
 $('#app').classList.toggle('dashboard-active',page==='dashboard');
 const initials=(currentUser?.name||'MF').split(/\s+/).slice(0,2).map(part=>part.charAt(0)).join('').toUpperCase();
 setUserAvatar($('#topbarAvatar'),currentUser,initials);
 document.querySelectorAll('.nav-item[data-page]').forEach(item=>item.classList.toggle('hidden',!canAccessPage(item.dataset.page)));
 document.querySelectorAll('.nav-section-label').forEach((label,index)=>label.classList.toggle('hidden',isStaffProfile()&&index>0));
 $('#navDashboardLabel').textContent=employee?'Painel Geral':'Dashboard';
 $('#navStockLabel').textContent=employee?'Consultar Preço':'Estoque';
 $('#navExpiryLabel').textContent=employee?'Lista de Validades':'Validade';
 $('#navLossLabel').textContent=employee?'Registrar Perda':'Registrar perda';
 $('#navTasksLabel').textContent=employee?'Minhas Tarefas':'Minhas tarefas';
 $('#navConfigLabel').textContent='Configurações';
 document.querySelector('.nav-section-label').textContent=employee?'Menu principal':'Principal';
 $('#headerProductSearch').placeholder=employee?'Consulta rápida: nome do produto':'Buscar produto';
 $('#headerProductSearch').setAttribute('aria-label',employee?'Consulta rápida por produto':'Buscar produto');
 if(!canAccessPage(page)){go('dashboard');return}
 if(page==='dashboard')dashboard(); if(page==='estoque')stock(); if(page==='validade')expiry(); if(page==='financeiro')finance(); if(page==='unidades')unitPage(); if(page==='relatorios')reportPage(); if(page==='config')config(); if(page==='perda')lossPage(); if(page==='tarefas')tasksPage(); if(page==='tarefas-equipe')staffTaskMonitorPage();
 if(page==='perfis')profilePage();
}
function dashboard(){
 pageHeader('Dashboard','Resumo do seu mercadinho hoje');
 if(isStaffProfile()){staffDashboard();return}
 const scopedProducts=products.filter(matchesSelectedUnit);
 const scopedTransactions=transactions.filter(matchesSelectedUnit);
 const unitLabel=selectedUnitId()==='all'?'Todas as unidades':selectedUnitName();
 pageHeader('Dashboard',`Resumo de ${unitLabel}`);
 const startOfDay=date=>new Date(date.getFullYear(),date.getMonth(),date.getDate());
 const today=startOfDay(new Date());
 const transactionDate=transaction=>{
  const date=reportDate(transaction.date)||(transaction.createdAt?new Date(transaction.createdAt):null);
  return date&&!Number.isNaN(date.getTime())?startOfDay(date):null;
 };
 const sales=scopedTransactions.filter(transaction=>transaction.type==='Entrada'||(!transaction.type&&Number(transaction.value)>0));
 const weekStart=new Date(today); weekStart.setDate(weekStart.getDate()-6);
 const previousStart=new Date(today); previousStart.setDate(previousStart.getDate()-13);
 const previousEnd=new Date(weekStart); previousEnd.setDate(previousEnd.getDate()-1);
 const sumSales=(start,end)=>sales.reduce((sum,transaction)=>{
  const date=transactionDate(transaction);
  return date&&date>=start&&date<=end?sum+Math.abs(Number(transaction.value)||0):sum;
 },0);
 const weekSales=sumSales(weekStart,today);
 const previousSales=sumSales(previousStart,previousEnd);
 const change=previousSales?Math.round((weekSales-previousSales)/previousSales*100):null;
 const changeLabel=change===null?(weekSales?'Novo':'0%'):`${change>=0?'+':''}${change}%`;
 const changeIcon=change===null?'':change>=0?'↗':'↘';
 const changeDescription=change===null?'':'vs. semana anterior';
 const dailyTotals=Array.from({length:7},(_,index)=>{
  const date=new Date(weekStart); date.setDate(date.getDate()+index);
  return {date,total:sumSales(date,date)};
 });
 const chartMax=Math.max(...dailyTotals.map(day=>day.total),1);
 const chartPoints=dailyTotals.map((day,index)=>`${index*50},${40-(day.total/chartMax*30)}`).join(' ');
 const chartLabels=dailyTotals.map(day=>day.date.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.',''));
 const todayItems=sales.filter(transaction=>transactionDate(transaction)?.getTime()===today.getTime()).flatMap(transaction=>{
  if(Array.isArray(transaction.items))return transaction.items;
  return transaction.product?[{name:transaction.product,qty:transaction.qty||1}]:[];
 });
 const soldByProduct={};
 todayItems.forEach(item=>{
  const name=item.name||item.product||'Produto';
  soldByProduct[name]=(soldByProduct[name]||0)+(Number(item.qty)||1);
 });
 const bestSellers=Object.entries(soldByProduct).map(([name,qty])=>({name,qty})).sort((a,b)=>b.qty-a.qty).slice(0,3);
 const maxSold=Math.max(...bestSellers.map(item=>item.qty),1);
 const categoryTotals={};
 scopedProducts.forEach(product=>{const category=product.cat||'Sem categoria';categoryTotals[category]=(categoryTotals[category]||0)+(Number(product.qty)||0)});
 const totalStock=Object.values(categoryTotals).reduce((sum,qty)=>sum+qty,0);
 const categories=Object.entries(categoryTotals).sort((a,b)=>b[1]-a[1]).slice(0,4);
 const lowProducts=scopedProducts.filter(product=>Number(product.qty)<=Number(product.min));
 const nearProducts=scopedProducts.filter(product=>daysTo(product.date)>=0&&daysTo(product.date)<=7).sort((a,b)=>daysTo(a.date)-daysTo(b.date));
 const recentProducts=scopedProducts.filter(product=>Number.isFinite(Number(product.id))).map(product=>({kind:'product',label:`Produto cadastrado: ${product.name}`,date:new Date(Number(product.id))}));
 const recentTransactions=scopedTransactions.map(transaction=>({kind:'transaction',label:transaction.desc||'Movimentação financeira registrada',date:transaction.createdAt?new Date(transaction.createdAt):reportDate(transaction.date)})).filter(item=>item.date&&!Number.isNaN(item.date.getTime()));
 const activityFrom=localStorage.getItem(dashboardActivityFromKey)||'';
 const activityTo=localStorage.getItem(dashboardActivityToKey)||'';
 const activityStart=activityFrom?new Date(`${activityFrom}T00:00:00`):null;
 const activityEnd=activityTo?new Date(`${activityTo}T23:59:59.999`):null;
 const activityDateInvalid=Boolean(activityFrom&&activityTo&&activityFrom>activityTo);
 const activities=[...recentProducts,...recentTransactions]
  .filter(activity=>!activityDateInvalid&&(!activityStart||activity.date>=activityStart)&&(!activityEnd||activity.date<=activityEnd))
  .sort((a,b)=>b.date-a.date);
 const firstName=(currentUser?.name||'').trim().split(/\s+/)[0]||'';
 const attention=nearProducts.length
  ?`<p>${nearProducts[0].name} vence ${daysTo(nearProducts[0].date)===0?'hoje':`em ${daysTo(nearProducts[0].date)} dia(s)`}. Confira também os demais produtos próximos do vencimento.</p><button onclick="go('validade')">Conferir validade</button>`
  :lowProducts.length
   ?`<p>${lowProducts.length} produto(s) estão no estoque mínimo ou abaixo dele.</p><button onclick="go('estoque')">Conferir estoque</button>`
   :'<p>Tudo em ordem: não há produtos próximos do vencimento nem estoque abaixo do mínimo.</p>';
 const activityMarkup=activityDateInvalid
  ?'<p class="dashboard-empty" role="alert">A data inicial não pode ser posterior à data final.</p>'
  :activities.length
   ?activities.map((activity,index)=>`<div class="activity-row"><span class="activity-avatar activity-avatar-${index%3}">${activity.kind==='product'?'＋':'↻'}</span><div><b>${escapeHTML(currentUser?.name||'Usuário')}</b><p>${escapeHTML(activity.label)}</p><small>${activity.date.toLocaleDateString('pt-BR')}</small></div></div>`).join('')
   :`<p class="dashboard-empty">${activityFrom||activityTo?'Nenhuma alteração encontrada nesse período.':'As movimentações recentes aparecerão aqui.'}</p>`;
 const adminStaffTools=isAdmin()?`<div class="staff-admin-tools">
  <section class="panel staff-admin-panel"><h3>Atribuir tarefa</h3><form class="staff-admin-form" onsubmit="createStaffTask(event)"><label for="newStaffTask">Tarefa</label><input id="newStaffTask" maxlength="160" placeholder="Ex.: Conferir validade da geladeira" required><label for="staffTaskAssignee">Enviar para</label><select id="staffTaskAssignee" required>${staffRecipientOptions('Escolha um funcionário ou a equipe')}</select><button class="primary" type="submit">Atribuir tarefa</button></form></section>
  <section class="panel staff-admin-panel"><h3>Publicar aviso</h3><form class="staff-admin-form" onsubmit="createStaffNotice(event)"><label for="newStaffNotice">Recado importante</label><textarea id="newStaffNotice" maxlength="500" rows="4" placeholder="Escreva um recado importante para a equipe..." required></textarea><label for="staffNoticeRecipient">Enviar para</label><select id="staffNoticeRecipient" required>${staffRecipientOptions('Escolha um funcionário ou a equipe')}</select><button class="primary" type="submit">Publicar aviso</button></form><div class="staff-admin-notices">${staffNotices.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(notice=>`<div><p><small>Para: ${escapeHTML(notice.recipientName||staffRecipientName(notice.recipientId||'all'))}</small><br>${escapeHTML(notice.message)}</p><button class="danger-button" type="button" onclick="removeStaffNotice('${encodeURIComponent(String(notice.id))}')">Excluir</button></div>`).join('')}</div></section>
 </div>`:'';
 $('#content').innerHTML=`<div class="page dashboard-page">
  <section class="welcome dashboard-hero">
   <div class="dashboard-hero-copy"><div class="hello">Olá${firstName?`, ${firstName}`:''}!</div><h1>Seja bem-vindo ao MercadoFácil!</h1><p>Aqui está o resumo do seu mercadinho hoje. Tudo o que precisa de atenção aparece primeiro.</p><div class="dashboard-actions"><button class="hero-button" onclick="openModal()">Adicionar produto</button><button class="hero-button secondary-hero-button" onclick="go('estoque')">Atualizar estoque</button></div></div>
   <div class="weekly-sales"><span>Vendas da semana</span><strong>${money(weekSales)}</strong><small class="${change===null?'trend-neutral':change>=0?'trend-up':'trend-down'}">${changeIcon} ${changeLabel} <i>${changeDescription}</i></small><svg viewBox="0 0 300 50" preserveAspectRatio="none" role="img" aria-label="Gráfico de vendas dos últimos sete dias"><polygon points="0,50 ${chartPoints} 300,50"></polygon><polyline points="${chartPoints}"></polyline></svg><div class="chart-labels">${chartLabels.map(label=>`<span>${label}</span>`).join('')}</div></div>
  </section>
  <div class="dashboard-panels">
   <div class="dashboard-column">
    <section class="panel dashboard-panel best-sellers-panel"><h3>Mais vendidos hoje</h3>${bestSellers.length?bestSellers.map(item=>`<div class="best-seller"><span class="best-seller-icon">▣</span><span class="best-seller-name">${item.name}</span><strong>${item.qty}</strong><div class="seller-track"><i style="width:${item.qty/maxSold*100}%"></i></div></div>`).join(''):'<p class="dashboard-empty">Ainda não há vendas de produtos registradas hoje.</p>'}<small class="panel-note">Os produtos vendidos aparecem aqui conforme as vendas do dia.</small></section>
    <section class="panel dashboard-panel category-panel"><h3>Giro por categoria</h3>${categories.length?categories.map(([name,qty])=>`<div class="category-row"><div><span class="category-dot"></span><span>${name}</span><strong>${totalStock?Math.round(qty/totalStock*100):0}%</strong></div><div class="category-track"><i style="width:${totalStock?qty/totalStock*100:0}%"></i></div></div>`).join(''):'<p class="dashboard-empty">Cadastre produtos para acompanhar o estoque por categoria.</p>'}<small class="panel-note">Distribuição das quantidades cadastradas por categoria.</small></section>
   </div>
   <div class="dashboard-column">
    <section class="panel dashboard-panel attention-panel"><h3>Precisa de atenção</h3>${attention}</section>
    <section class="panel dashboard-panel activity-panel"><div class="activity-heading"><h3>Atividade recente</h3><button class="activity-clear-filter" type="button" onclick="clearDashboardActivityFilter()">Limpar filtro</button></div><div class="activity-date-filters"><div><label for="dashboardActivityFrom">De</label><input id="dashboardActivityFrom" type="date" value="${escapeHTML(activityFrom)}" onchange="filterDashboardActivity()"></div><div><label for="dashboardActivityTo">Até</label><input id="dashboardActivityTo" type="date" value="${escapeHTML(activityTo)}" onchange="filterDashboardActivity()"></div></div><div class="activity-list-scroll">${activityMarkup}</div></section>
   </div>
  </div>
  ${adminStaffTools}
 </div>`;
}
function staffDashboard(){
 pageHeader('Painel Geral','Resumo do seu turno');
 const scopedProducts=products.filter(matchesSelectedUnit);
 const myTasks=staffTasks.filter(taskAssignedToCurrentStaff);
 const completedTasks=myTasks.filter(task=>task.completed).length;
 const notices=staffNotices.filter(noticeVisibleToCurrentStaff).slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
 const overdue= scopedProducts.filter(product=>daysTo(product.date)<0).sort((a,b)=>daysTo(a.date)-daysTo(b.date));
 const dueToday=scopedProducts.filter(product=>daysTo(product.date)===0);
 const dueSoon=scopedProducts.filter(product=>daysTo(product.date)>0&&daysTo(product.date)<=7);
 const lowStock=scopedProducts.filter(product=>Number(product.qty)<=Number(product.min));
 const urgentProducts=[...overdue,...dueToday,...dueSoon].sort((a,b)=>daysTo(a.date)-daysTo(b.date));
 const firstName=(currentUser?.name||'').trim().split(/\s+/)[0]||'';
 const unitLabel=selectedUnitId()==='all'?'Todas as unidades':selectedUnitName();
 const greetingHour=new Date().getHours();
 const greeting=greetingHour<12?'Bom dia':greetingHour<18?'Boa tarde':'Boa noite';
 const urgencyLabel=product=>daysTo(product.date)<0?`Vencido há ${Math.abs(daysTo(product.date))} ${Math.abs(daysTo(product.date))===1?'dia':'dias'}`:daysTo(product.date)===0?'Vence hoje':`Vence em ${daysTo(product.date)} dias`;
 $('#content').innerHTML=`<div class="page employee-dashboard">
  <header class="employee-welcome"><div><p>${greeting}, ${escapeHTML(firstName)}!</p><h1>Resumo do turno</h1></div><span>${escapeHTML(unitLabel)} · ${new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'})}</span></header>
  <section class="employee-metrics" aria-label="Resumo do turno">
   <button class="employee-metric metric-red" type="button" onclick="go('validade')"><span>Vencem hoje</span><strong>${dueToday.length}</strong><small>${overdue.length} produto(s) já vencido(s)</small></button>
   <button class="employee-metric metric-orange" type="button" onclick="go('validade')"><span>Vencem em 7 dias</span><strong>${dueSoon.length}</strong><small>Confira as próximas validades</small></button>
   <button class="employee-metric metric-green" type="button" onclick="go('tarefas')"><span>Minhas tarefas</span><strong>${completedTasks}/${myTasks.length}</strong><small>${myTasks.length-completedTasks} pendentes</small></button>
   <button class="employee-metric metric-blue" type="button" onclick="go('estoque')"><span>Estoque baixo</span><strong>${lowStock.length}</strong><small>Produtos para repor</small></button>
  </section>
  <div class="employee-dashboard-grid">
   <section class="panel employee-panel employee-expiry-panel"><header class="employee-panel-heading"><div><h2>Alertas de Validade</h2><p>Produtos vencidos e próximos do vencimento</p></div><button class="employee-text-button" type="button" onclick="go('validade')">Ver lista completa</button></header>
    ${urgentProducts.length?`<div class="employee-expiry-list">${urgentProducts.slice(0,8).map(product=>`<article class="employee-expiry-row ${daysTo(product.date)<=0?'expiry-critical':''}"><span class="employee-product-mark">${product.emoji||'📦'}</span><div class="employee-expiry-product"><b>${escapeHTML(product.name)}</b><small>${escapeHTML(product.cat||'Sem categoria')} · ${escapeHTML(productUnitName(product))}</small></div><span class="employee-expiry-date">${escapeHTML(urgencyLabel(product))}</span><button type="button" class="employee-row-action" onclick="${daysTo(product.date)<=0?`openLossForProduct('${encodeURIComponent(String(product.id))}')`:`go('validade')`}">${daysTo(product.date)<=0?'Registrar perda':'Ver validade'}</button></article>`).join('')}</div>`:'<p class="staff-empty">Nenhum produto vencido ou próximo do vencimento nesta unidade.</p>'}
   </section>
   <section class="panel employee-panel employee-tasks-panel"><header class="employee-panel-heading"><div><h2>Minhas Tarefas do Turno</h2><p>${completedTasks} de ${myTasks.length} concluídas</p></div><button class="employee-text-button" type="button" onclick="go('tarefas')">Ver todas</button></header>${staffTaskListMarkup(myTasks,true)}</section>
   <section class="panel employee-panel employee-notices-panel"><header class="employee-panel-heading"><div><h2>Mural de Recados</h2><p>Avisos importantes da administração</p></div></header>${staffNoticeListMarkup(notices.slice(0,4))}</section>
  </div>
 </div>`;
}
function openLossForProduct(encodedId){
 const productId=decodeURIComponent(encodedId);
 if(!products.some(product=>String(product.id)===productId&&matchesSelectedUnit(product))){alert('Este produto não está disponível na unidade selecionada.');return}
 pendingLossProductId=productId;
 go('perda');
}
function staffTaskListMarkup(tasks,compact=false){
 if(!tasks.length)return '<p class="staff-empty">Você não tem tarefas pendentes no momento.</p>';
 const visible=compact?tasks.slice().sort((a,b)=>Number(a.completed)-Number(b.completed)||new Date(b.createdAt)-new Date(a.createdAt)).slice(0,6):tasks.slice().sort((a,b)=>Number(a.completed)-Number(b.completed)||new Date(b.createdAt)-new Date(a.createdAt));
 return `<ul class="staff-task-list">${visible.map(task=>`<li class="${task.completed?'is-complete':''}"><label><input type="checkbox" ${task.completed?'checked':''} onchange="toggleStaffTask('${encodeURIComponent(String(task.id))}',this.checked)"><span>${escapeHTML(task.title)}</span></label>${task.dueDate?`<small>Prazo: ${new Date(`${task.dueDate}T00:00:00`).toLocaleDateString('pt-BR')}</small>`:''}</li>`).join('')}</ul>${compact&&tasks.length>visible.length?`<button class="staff-more-link" type="button" onclick="go('tarefas')">Ver todas as ${tasks.length} tarefas</button>`:''}`;
}
function staffNoticeListMarkup(notices){
 if(!notices.length)return '<p class="staff-empty">Nenhum aviso publicado ainda.</p>';
 return `<div class="staff-notice-list">${notices.map(notice=>`<article><p>${escapeHTML(notice.message)}</p><small>${new Date(notice.createdAt).toLocaleString('pt-BR')}</small></article>`).join('')}</div>`;
}
function activeStaffProfiles(){return profiles.filter(profile=>isStaffProfile(profile)&&isProfileActive(profile))}
function staffRecipientOptions(placeholder){
 return `<option value="">${placeholder}</option><option value="all">Todos os funcionários</option>${activeStaffProfiles().map(profile=>`<option value="${escapeHTML(String(profile.id))}">${escapeHTML(profile.name)} · ${escapeHTML(profile.jobTitle||profileTypeLabel(normalizedProfileType(profile)))}</option>`).join('')}`;
}
function staffRecipientName(profileId){
 return profileId==='all'?'Todos os funcionários':profiles.find(profile=>String(profile.id)===String(profileId))?.name||'Funcionário removido';
}
function taskAssignedToCurrentStaff(task){
 return String(task.assigneeId)===String(currentUser?.id)||Array.isArray(task.assigneeIds)&&task.assigneeIds.some(id=>String(id)===String(currentUser?.id));
}
function noticeVisibleToCurrentStaff(notice){
 const recipientId=notice.recipientId||'all';
 return recipientId==='all'||String(recipientId)===String(currentUser?.id);
}
function tasksPage(){
 pageHeader('Minhas tarefas','Acompanhe e marque suas tarefas concluídas');
 const myTasks=staffTasks.filter(taskAssignedToCurrentStaff);
 $('#content').innerHTML=`<div class="page staff-page"><section class="panel staff-dashboard-panel"><div class="staff-panel-heading"><div><h2>Checklist de tarefas</h2><p>Marque cada tarefa quando concluir.</p></div></div>${staffTaskListMarkup(myTasks)}</section></div>`;
}
function toggleStaffTask(encodedId,completed){
 const id=decodeURIComponent(encodedId);
 const task=staffTasks.find(item=>String(item.id)===id&&taskAssignedToCurrentStaff(item));
 if(!task){alert('Esta tarefa não foi encontrada.');return}
 task.completed=Boolean(completed);
 task.completedAt=task.completed?new Date().toISOString():'';
 task.completedBy=task.completed?(currentUser?.name||'Funcionário'):'';
 save();
 if(document.querySelector('.nav-item.active')?.dataset.page==='dashboard')staffDashboard();else tasksPage();
}
function staffTaskMonitorPage(){
 if(!isAdmin()){go('dashboard');return}
 pageHeader('Acompanhar Tarefas','Verifique as tarefas e os checks realizados pela equipe');
 const staff=activeStaffProfiles();
 const tasks=staffTasks.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
 const completed=tasks.filter(task=>task.completed).length;
 const pending=tasks.length-completed;
 const staffOptions=`<option value="all">Todos os funcionários</option>${staff.map(profile=>`<option value="${escapeHTML(String(profile.id))}">${escapeHTML(profile.name)}</option>`).join('')}`;
 $('#content').innerHTML=`<div class="page staff-monitor-page">
  <section class="staff-monitor-summary" aria-label="Resumo das tarefas"><article><span>Total de tarefas</span><strong>${tasks.length}</strong></article><article><span>Concluídas</span><strong>${completed}</strong></article><article><span>Pendentes</span><strong>${pending}</strong></article></section>
  <section class="panel staff-monitor-panel"><header class="staff-monitor-heading"><div><h2>Acompanhamento da equipe</h2><p>O status e o horário refletem o check realizado pelo funcionário.</p></div><label for="staffTaskMonitorFilter">Filtrar funcionário<select id="staffTaskMonitorFilter" class="filter-select" onchange="filterStaffTaskMonitor()">${staffOptions}</select></label></header><div id="staffTaskMonitorList"></div></section>
 </div>`;
 drawStaffTaskMonitor();
}
function drawStaffTaskMonitor(){
 const list=$('#staffTaskMonitorList');
 if(!list)return;
 const summary=$('.staff-monitor-summary');
 if(summary){
  const completed=staffTasks.filter(task=>task.completed).length;
  summary.innerHTML=`<article><span>Total de tarefas</span><strong>${staffTasks.length}</strong></article><article><span>Concluídas</span><strong>${completed}</strong></article><article><span>Pendentes</span><strong>${staffTasks.length-completed}</strong></article>`;
 }
 const selected=$('#staffTaskMonitorFilter')?.value||'all';
 const staff=activeStaffProfiles().filter(profile=>selected==='all'||String(profile.id)===selected);
 if(!staff.length){list.innerHTML='<p class="staff-empty">Nenhum funcionário ativo encontrado.</p>';return}
 list.innerHTML=staff.map(profile=>{
  const assigned=staffTasks.filter(task=>String(task.assigneeId)===String(profile.id)||Array.isArray(task.assigneeIds)&&task.assigneeIds.some(id=>String(id)===String(profile.id))).sort((a,b)=>Number(a.completed)-Number(b.completed)||new Date(b.createdAt)-new Date(a.createdAt));
  const done=assigned.filter(task=>task.completed).length;
  const rows=assigned.map(task=>`<li class="staff-monitor-task ${task.completed?'is-complete':''}"><span class="staff-monitor-check ${task.completed?'checked':''}" aria-label="${task.completed?'Concluída':'Pendente'}">${task.completed?'✓':'○'}</span><div class="staff-monitor-task-copy"><b>${escapeHTML(task.title)}</b><small>${task.completed?`Concluída por ${escapeHTML(task.completedBy||profile.name)}${task.completedAt?` · ${new Date(task.completedAt).toLocaleString('pt-BR')}`:''}`:`Atribuída em ${new Date(task.createdAt).toLocaleDateString('pt-BR')}`}</small></div><span class="staff-monitor-status ${task.completed?'done':'waiting'}">${task.completed?'Concluída':'Pendente'}</span></li>`).join('');
  return `<section class="staff-monitor-employee"><header><div><h3>${escapeHTML(profile.name)}</h3><span>${escapeHTML(profile.jobTitle||profileTypeLabel(normalizedProfileType(profile)))}</span></div><strong>${done}/${assigned.length} concluídas</strong></header>${assigned.length?`<ul class="staff-monitor-task-list">${rows}</ul>`:'<p class="staff-empty">Nenhuma tarefa atribuída.</p>'}</section>`;
 }).join('');
}
function filterStaffTaskMonitor(){drawStaffTaskMonitor()}
function createStaffTask(event){
 event.preventDefault();
 if(!isAdmin()){alert('Somente um administrador pode atribuir tarefas.');return}
 const assigneeId=$('#staffTaskAssignee').value;
 const recipients=assigneeId==='all'?activeStaffProfiles():activeStaffProfiles().filter(profile=>String(profile.id)===assigneeId);
 const title=$('#newStaffTask').value.trim();
 if(!recipients.length||!title){alert('Selecione ao menos um funcionário ativo e informe a tarefa.');return}
 const createdAt=new Date().toISOString();
 recipients.forEach((assignee,index)=>staffTasks.unshift({id:newClientId(),title,assigneeId:String(assignee.id),assigneeName:assignee.name,completed:false,createdAt}));
 save();
 dashboard();
}
function createStaffNotice(event){
 event.preventDefault();
 if(!isAdmin()){alert('Somente um administrador pode publicar avisos.');return}
 const message=$('#newStaffNotice').value.trim();
 const recipientId=$('#staffNoticeRecipient').value;
 const recipients=recipientId==='all'?activeStaffProfiles():activeStaffProfiles().filter(profile=>String(profile.id)===recipientId);
 if(!message||!recipients.length){alert('Escreva o recado e selecione ao menos um funcionário ativo.');return}
 staffNotices.unshift({id:newClientId(),message,recipientId,recipientName:staffRecipientName(recipientId),createdAt:new Date().toISOString()});
 save();
 dashboard();
}
function removeStaffNotice(encodedId){
 if(!isAdmin()){alert('Somente um administrador pode excluir avisos.');return}
 const id=decodeURIComponent(encodedId);
 staffNotices=staffNotices.filter(notice=>String(notice.id)!==id);
 save();
 dashboard();
}
function lossPage(){
 pageHeader('Registrar perda','Registre produtos danificados, vencidos ou descartados');
 const scopedProducts=products.filter(matchesSelectedUnit);
 const recentLosses=transactions.filter(transaction=>transaction.type==='Perda'&&matchesSelectedUnit(transaction)).slice(0,10);
 $('#content').innerHTML=`<div class="page staff-page"><section class="panel loss-form-panel"><h2>Nova perda</h2><p class="muted">A quantidade registrada será descontada do estoque da unidade do produto.</p><form class="loss-form" onsubmit="recordLoss(event)"><label for="lossProduct">Produto</label><select id="lossProduct" required><option value="">Selecione um produto</option>${scopedProducts.map(product=>`<option value="${escapeHTML(String(product.id))}">${escapeHTML(product.name)} · ${product.qty} un. · ${escapeHTML(productUnitName(product))}</option>`).join('')}</select><label for="lossQuantity">Quantidade perdida</label><input id="lossQuantity" type="number" min="0.01" step="any" required><label for="lossReason">Motivo da perda</label><select id="lossReason" required><option value="">Selecione o motivo</option><option>Produto vencido</option><option>Produto danificado</option><option>Descarte</option><option>Outro</option></select><label for="lossDetails">Observações</label><textarea id="lossDetails" maxlength="300" rows="3" placeholder="Detalhes adicionais (opcional)"></textarea><button class="primary" type="submit" ${scopedProducts.length?'':'disabled'}>Registrar perda</button></form>${scopedProducts.length?'':'<p class="staff-empty">Não há produtos cadastrados na unidade selecionada.</p>'}</section><section class="panel loss-history-panel"><h2>Perdas recentes</h2>${recentLosses.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Data</th><th>Produto</th><th>Quantidade</th><th>Motivo</th><th>Funcionário</th></tr></thead><tbody>${recentLosses.map(loss=>`<tr><td>${new Date(loss.createdAt).toLocaleString('pt-BR')}</td><td>${escapeHTML(loss.product||'')}</td><td>${Number(loss.qty)||0}</td><td>${escapeHTML(loss.reason||'')}</td><td>${escapeHTML(loss.employee||'')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="staff-empty">As perdas registradas aparecerão aqui.</p>'}</section></div>`;
 if(pendingLossProductId){$('#lossProduct').value=pendingLossProductId;pendingLossProductId=''}
}
function recordLoss(event){
 event.preventDefault();
 if(!isStaffProfile()){alert('Somente funcionários podem registrar perdas.');return}
 const product=products.find(item=>String(item.id)===$('#lossProduct').value&&matchesSelectedUnit(item));
 const qty=Number($('#lossQuantity').value);
 const reason=$('#lossReason').value;
 if(!product){alert('Selecione um produto da unidade atual.');return}
 if(!Number.isFinite(qty)||qty<=0||qty>Number(product.qty)){alert(`Informe uma quantidade maior que zero e até ${Number(product.qty)||0}.`);return}
 if(!reason){alert('Selecione o motivo da perda.');return}
 const unitId=productUnitId(product);
 const unit=units.find(item=>String(item.id)===unitId);
 const details=$('#lossDetails').value.trim();
 product.qty=Number(product.qty)-qty;
 transactions.unshift({date:new Date().toLocaleDateString('pt-BR'),createdAt:new Date().toISOString(),desc:`Perda: ${product.name} (${reason})${details?` — ${details}`:''}`,type:'Perda',value:qty*(Number(product.price)||0),unitId,unidade_id:unitId,unit:unit?.name||'',product:product.name,qty,reason,details,employee:currentUser?.name||''});
 save();
 alert('Perda registrada e estoque atualizado.');
 lossPage();
}
function filterDashboardActivity(){
 const from=$('#dashboardActivityFrom')?.value||'';
 const to=$('#dashboardActivityTo')?.value||'';
 localStorage.setItem(dashboardActivityFromKey,from);
 localStorage.setItem(dashboardActivityToKey,to);
 dashboard();
}
function clearDashboardActivityFilter(){
 localStorage.removeItem(dashboardActivityFromKey);
 localStorage.removeItem(dashboardActivityToKey);
 dashboard();
}
function stock(){
 const employeeView=isStaffProfile();
 pageHeader(employeeView?'Consultar Preço':'Estoque',employeeView?'Consulte preços, quantidades e validade dos produtos':'Controle seus produtos e quantidades');
 const categories=[...new Set(products.map(product=>String(product.cat||'').trim()).filter(Boolean))].sort((left,right)=>left.localeCompare(right,'pt-BR'));
 const savedCategory=localStorage.getItem('mf_stock_category')||'all';
 const categoryOptions=categories.map(category=>`<option value="${escapeHTML(category)}" ${savedCategory===category?'selected':''}>${escapeHTML(category)}</option>`).join('');
 $('#content').innerHTML=`<div class="page stock-page"><div class="toolbar stock-toolbar"><input id="searchStock" class="search" placeholder="🔎  ${employeeView?'Buscar produto ou preço...':'Buscar produto...'}" oninput="filterStock()"><div class="toolbar-actions"><select id="stockStatusFilter" class="filter-select" aria-label="Filtrar por status" onchange="filterStock()"><option value="Todos">Todos os status</option><option>Normal</option><option>Estoque baixo</option><option>Próximo</option><option>Urgente</option><option>Vencido</option></select><select id="stockCategoryFilter" class="filter-select" aria-label="Filtrar por categoria" onchange="filterStock()"><option value="all">Todas as categorias</option>${categoryOptions}</select>${employeeView?'':'<button class="primary" onclick="openModal()">+ Adicionar produto</button>'}</div></div><div id="stockCount" class="stock-count"></div><div id="stockTable" class="table-wrap stock-table-wrap"></div>${isAdmin()?'<section id="spreadsheetImportSection" class="spreadsheet-import-card"></section>':''}</div>`;
 $('#stockStatusFilter').value=localStorage.getItem('mf_stock_status')||'Todos';
 if(!['Todos','Normal','Estoque baixo','Próximo','Urgente','Vencido'].includes($('#stockStatusFilter').value))$('#stockStatusFilter').value='Todos';
 if(!categories.includes(savedCategory))$('#stockCategoryFilter').value='all';
 drawStock();
 if(isAdmin())renderSpreadsheetImport();
}
function unitProducts(unitId){return products.filter(product=>productUnitId(product)===String(unitId))}
function unitTransactions(unitId){const unit=units.find(item=>String(item.id)===String(unitId));return transactions.filter(transaction=>String(transaction.unitId||transaction.unidade_id||'')===String(unitId)||(unit&&normalizedUnitName(transaction.unit)===normalizedUnitName(unit.name)))}
function unitDetail(unitId){
 const unit=units.find(item=>String(item.id)===String(unitId));
 if(!unit){unitPage();return}
 const unitProductsList=unitProducts(unit.id);
 const unitTransactionsList=unitTransactions(unit.id);
 const revenue=unitTransactionsList.filter(item=>item.type==='Entrada').reduce((sum,item)=>sum+Math.abs(Number(item.value)||0),0);
 const low=unitProductsList.filter(product=>product.qty<=product.min).length;
 const expired=unitProductsList.filter(product=>daysTo(product.date)<0).length;
 localStorage.setItem('mf_selected_unit',String(unit.id));
 localStorage.setItem('mf_report_unit',String(unit.id));
 updateUnitSelector();
 pageHeader(unit.name,'Administração individual da unidade');
 const productRows=unitProductsList.map(product=>{
  const state=status(product);
  return `<tr><td><b>${product.emoji||'📦'} ${escapeHTML(product.name)}</b></td><td>${Number(product.qty)||0}</td><td>${escapeHTML(new Date(`${product.date}T00:00:00`).toLocaleDateString('pt-BR'))}</td><td><span class="status ${state[1]}">${state[0]}</span></td></tr>`;
 }).join('');
 const movementRows=unitTransactionsList.map(item=>{
  const date=transactionDateTime(item);
  return `<tr><td>${escapeHTML(date?date.toLocaleString('pt-BR'):item.date||'—')}</td><td>${escapeHTML(item.desc||'')}</td><td>${escapeHTML(item.type||'')}</td><td>${escapeHTML(item.formaPagamento||item.payment||'—')}</td><td class="value-${item.type==='Entrada'?'entry':'exit'}">${money(Math.abs(Number(item.value)||0))}</td></tr>`;
 }).join('');
 $('#content').innerHTML=`<div class="page unit-detail-page"><button class="back-link" onclick="unitPage()">← Voltar para unidades</button><div class="unit-detail-header"><div><div class="unit-detail-title"><h1>${escapeHTML(unit.name)}</h1><span class="status ${unit.status==='Ativo'?'':'warn'}">${escapeHTML(unit.status)}</span></div><p class="muted">${escapeHTML(unit.location)} · ${escapeHTML(unit.block)}</p><p class="unit-manager"><b>Responsável:</b> ${escapeHTML(unit.manager)}</p></div><div class="unit-detail-actions"><button class="secondary" onclick="openUnitModal(${Number(unit.id)})">Editar cadastro</button><button class="primary" onclick="openModalForUnit(${Number(unit.id)})">+ Adicionar produto</button></div></div><div class="metric-grid unit-metrics"><div class="metric"><span>Faturamento</span><strong>${money(revenue)}</strong><small>Movimentações da unidade</small></div><div class="metric"><span>Produtos cadastrados</span><strong>${unitProductsList.length}</strong><small>Itens vinculados</small></div><div class="metric"><span>Estoque baixo</span><strong>${low}</strong><small>Abaixo do mínimo</small></div><div class="metric"><span>Validades vencidas</span><strong>${expired}</strong><small>Exigem atenção</small></div></div><div class="unit-detail-grid"><section class="panel"><div class="panel-heading"><div><h3>Estoque da unidade</h3><span class="muted">Produtos vinculados a este ponto</span></div><button class="secondary" onclick="go('estoque')">Ver estoque geral</button></div><div class="table-wrap unit-table"><table class="table"><thead><tr><th>Produto</th><th>Quantidade</th><th>Validade</th><th>Status</th></tr></thead><tbody>${productRows||'<tr><td colspan="4" class="empty-cell">Nenhum produto vinculado a esta unidade.</td></tr>'}</tbody></table></div></section><section class="panel"><div class="panel-heading"><div><h3>Movimentações</h3><span class="muted">Entradas e saídas deste ponto</span></div><button class="secondary" onclick="go('financeiro')">Ver financeiro geral</button></div><div class="table-wrap unit-table"><table class="table"><thead><tr><th>Data e hora</th><th>Descrição</th><th>Tipo</th><th>Forma de pagamento</th><th>Valor</th></tr></thead><tbody>${movementRows||'<tr><td colspan="5" class="empty-cell">Nenhuma movimentação registrada.</td></tr>'}</tbody></table></div></section></div></div>`;
}
function drawStock(){
 const stockTable=$('#stockTable');
 if(!stockTable)return;
 const employeeView=isStaffProfile();
 const q=($('#searchStock')?.value||'').toLowerCase(); const selectedStatus=$('#stockStatusFilter')?.value||'Todos'; const selectedCategory=$('#stockCategoryFilter')?.value||'all'; const selectedUnit=selectedUnitId(); const list=products.filter(product=>{const currentStatus=status(product)[0];return matchesSelectedUnit(product)&&(String(product.name||'').toLowerCase().includes(q)||String(product.cat||'').toLowerCase().includes(q))&&(selectedStatus==='Todos'||currentStatus===selectedStatus)&&(selectedCategory==='all'||String(product.cat||'').trim()===selectedCategory)});
 localStorage.setItem('mf_stock_status',selectedStatus);
 localStorage.setItem('mf_stock_category',selectedCategory);
 selectedStockProductIds.forEach(id=>{if(!products.some(product=>String(product.id)===id))selectedStockProductIds.delete(id)});
 const allVisibleSelected=list.length>0&&list.every(product=>selectedStockProductIds.has(String(product.id)));
 const bulkToolbar=employeeView?'':`<div class="stock-bulk-toolbar ${selectedStockProductIds.size?'':'hidden'}"><span>${selectedStockProductIds.size} produto(s) selecionado(s)</span><button class="danger-button" type="button" onclick="removeSelectedStockProducts()">Excluir selecionados</button></div>`;
 const showUnitColumn=selectedUnit==='all';
 const unitHeader=showUnitColumn?'<th>Unidade</th>':'';
 const unitColumnClass=showUnitColumn?'stock-has-unit':'';
 const unitColgroup=showUnitColumn?'<col class="stock-col-unit">':'';
 const selectionHeader=employeeView?'':'<th><input class="stock-select-checkbox" type="checkbox" aria-label="Selecionar todos os produtos visíveis" '+(allVisibleSelected?'checked':'')+' onchange="toggleAllVisibleStockProducts(this.checked)"></th>';
 const selectionCol=employeeView?'':'<col class="stock-col-select">';
 const selectionCell=product=>employeeView?'':`<td><input class="stock-select-checkbox" type="checkbox" aria-label="Selecionar ${escapeHTML(product.name)}" ${selectedStockProductIds.has(String(product.id))?'checked':''} onchange="toggleStockProductSelection('${encodeURIComponent(String(product.id))}',this.checked)"></td>`;
 const actionHeader=employeeView?'':'<th></th>';
 const actionCol=employeeView?'':'<col class="stock-col-actions">';
 const actionCell=product=>employeeView?'':`<td><button class="secondary" onclick="removeProduct(${Number(product.id)})">Excluir</button></td>`;
 const count=$('#stockCount');
 if(count)count.textContent=`${list.length} ${list.length===1?'produto':'produtos'}${showUnitColumn?' · Todas as unidades':` · ${selectedUnitName()}`}`;
 stockTable.innerHTML=`${bulkToolbar}${list.length?`<div class="stock-list-scroll"><table class="table stock-data-table ${unitColumnClass}"><colgroup>${selectionCol}<col class="stock-col-product"><col class="stock-col-category"><col class="stock-col-quantity"><col class="stock-col-date"><col class="stock-col-price">${unitColgroup}<col class="stock-col-status">${actionCol}</colgroup><thead><tr>${selectionHeader}<th>Produto</th><th>Categoria</th><th>Quantidade</th><th>Validade</th><th>Preço</th>${unitHeader}<th>Status</th>${actionHeader}</tr></thead><tbody>${list.map(product=>{const state=status(product);const unitName=productUnitName(product);const unitCell=showUnitColumn?`<td class="stock-unit-cell" title="${escapeHTML(unitName)}">${escapeHTML(unitDisplayName(unitName))}</td>`:'';return `<tr>${selectionCell(product)}<td class="stock-product-cell" title="${escapeHTML(product.name)}"><b>${product.emoji||'📦'} ${escapeHTML(product.name)}</b></td><td>${escapeHTML(product.cat)}</td><td>${product.qty}</td><td>${new Date(product.date+'T00:00:00').toLocaleDateString('pt-BR')}</td><td>${money(product.price)}</td>${unitCell}<td><span class="status ${state[1]}">${state[0]}</span></td>${actionCell(product)}</tr>`}).join('')}</tbody></table></div>`:'<p class="empty-state">Nenhum produto nesta unidade/filtro.</p>'}`;
 stockTable.style.setProperty('--stock-row-count',Math.min(list.length,12));
}
function toggleStockProductSelection(encodedId,checked){
 const id=decodeURIComponent(encodedId);
 if(checked)selectedStockProductIds.add(id);
 else selectedStockProductIds.delete(id);
 drawStock();
}
function toggleAllVisibleStockProducts(checked){
 const query=($('#searchStock')?.value||'').toLowerCase();
 const selectedStatus=$('#stockStatusFilter')?.value||'Todos';
 const selectedCategory=$('#stockCategoryFilter')?.value||'all';
 const selectedUnit=selectedUnitId();
 const visibleProducts=products.filter(product=>{
  const currentStatus=status(product)[0];
 return matchesSelectedUnit(product)&&(product.name.toLowerCase().includes(query)||product.cat.toLowerCase().includes(query))&&(selectedStatus==='Todos'||currentStatus===selectedStatus)&&(selectedCategory==='all'||String(product.cat||'').trim()===selectedCategory);
 });
 visibleProducts.forEach(product=>{
  const id=String(product.id);
  if(checked)selectedStockProductIds.add(id);
  else selectedStockProductIds.delete(id);
 });
 drawStock();
}
function removeSelectedStockProducts(){
 if(!selectedStockProductIds.size)return;
 const selectedProducts=products.filter(product=>selectedStockProductIds.has(String(product.id)));
 if(!confirm(`Excluir ${selectedProducts.length} produto(s) selecionado(s)? Esta ação não pode ser desfeita.`))return;
 products=products.filter(product=>!selectedStockProductIds.has(String(product.id)));
 selectedStockProductIds.clear();
 save();
 drawStock();
}
function formatSpreadsheetSize(bytes){
 if(bytes<1024)return `${bytes} B`;
 if(bytes<1024*1024)return `${(bytes/1024).toFixed(0)} KB`;
 return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}
function spreadsheetSummary(){
 return {valid:spreadsheetImports.reduce((sum,file)=>sum+file.products.length,0),errors:spreadsheetImports.reduce((sum,file)=>sum+file.errorCount,0)};
}
function renderSpreadsheetImport(){
 const section=$('#spreadsheetImportSection');
 if(!section||!isAdmin())return;
 const totals=spreadsheetSummary();
 const count=spreadsheetImports.length;
 const remaining=3-count;
 const files=spreadsheetImports.map((item,index)=>{
  const details=[`${formatSpreadsheetSize(item.file.size)}`];
  if(item.products.length)details.push(`${item.products.length} ${item.products.length===1?'produto lido':'produtos lidos'}`);
  if(item.errorCount)details.push(`${item.errorCount} ${item.errorCount===1?'linha com erro':'linhas com erro'}`);
  return `<div class="spreadsheet-file-row"><span class="spreadsheet-file-icon" aria-hidden="true">▤</span><span class="spreadsheet-file-copy"><b title="${escapeHTML(item.file.name)}">${escapeHTML(item.file.name)}</b><small>${details.map(escapeHTML).join(' · ')}${item.errorMessage?` · ${escapeHTML(item.errorMessage)}`:''}</small></span><button class="spreadsheet-remove" type="button" aria-label="Remover ${escapeHTML(item.file.name)}" onclick="removeSpreadsheetFile(${index})">×</button></div>`;
 }).join('');
 const isSuccessMessage=spreadsheetImportMessage.startsWith('Importação concluída:');
 const errorMessage=spreadsheetImportMessage?`<p class="spreadsheet-import-message ${isSuccessMessage?'is-success':''}" role="${isSuccessMessage?'status':'alert'}">${escapeHTML(spreadsheetImportMessage)}</p>`:'';
 section.innerHTML=`<div class="spreadsheet-import-header"><div><h3>Importar planilhas</h3><p>Anexe até 3 arquivos (.xlsx, .xls ou .csv) de até 5 MB cada</p></div><button class="spreadsheet-template-link" type="button" onclick="downloadSpreadsheetTemplate()"><span aria-hidden="true">⇩</span> Baixar planilha modelo</button></div><div class="spreadsheet-import-body"><div id="spreadsheetDropzone" class="spreadsheet-dropzone ${count>=3?'is-disabled':''}"><input id="spreadsheetFileInput" class="hidden" type="file" accept=".xlsx,.xls,.csv" multiple ${count>=3?'disabled':''}><span class="spreadsheet-upload-icon" aria-hidden="true">⇧</span><b>Arraste as planilhas aqui</b><small>ou</small><button id="spreadsheetSelectFiles" type="button" ${count>=3?'disabled':''}>Selecionar arquivos</button></div><div class="spreadsheet-files"><div class="spreadsheet-files-heading"><b>Arquivos anexados</b><strong>${count} de 3</strong></div><div class="spreadsheet-file-list">${files}${remaining?`<div class="spreadsheet-free-space">Espaço livre para mais ${remaining} ${remaining===1?'arquivo':'arquivos'}</div>`:''}</div></div></div>${errorMessage}<div class="spreadsheet-import-footer"><div class="spreadsheet-import-guidance">${totals.errors?`<span class="spreadsheet-warning">${totals.errors} ${totals.errors===1?'aviso':'avisos'}</span>`:''}<span>Revise a prévia antes de confirmar</span></div><div class="spreadsheet-import-actions"><button id="clearSpreadsheetFiles" class="secondary" type="button" ${count?'':'disabled'}>Limpar</button><button id="previewSpreadsheetImport" class="primary" type="button" ${totals.valid?'':'disabled'}>Importar ${totals.valid} ${totals.valid===1?'produto':'produtos'}</button></div></div>`;
 if(count<3){
  const input=$('#spreadsheetFileInput');
  const zone=$('#spreadsheetDropzone');
  $('#spreadsheetSelectFiles').addEventListener('click',()=>input.click());
  input.addEventListener('change',async event=>{
   await addSpreadsheetFiles(event.target.files);
   event.target.value='';
  });
  zone.addEventListener('dragover',event=>{event.preventDefault();zone.classList.add('is-dragging')});
  zone.addEventListener('dragleave',()=>zone.classList.remove('is-dragging'));
  zone.addEventListener('drop',async event=>{
   event.preventDefault();
   zone.classList.remove('is-dragging');
   await addSpreadsheetFiles(event.dataTransfer.files);
  });
 }
 $('#clearSpreadsheetFiles').addEventListener('click',clearSpreadsheetFiles);
 $('#previewSpreadsheetImport').addEventListener('click',openSpreadsheetPreview);
}
function normalizeSpreadsheetHeader(value){
 return String(value??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
}
function spreadsheetNumber(value){
 if(typeof value==='number')return Number.isFinite(value)?value:NaN;
 const text=String(value??'').trim().replace(/[R$\s]/g,'');
 if(!text)return NaN;
 const normalized=text.includes(',')?text.replace(/\./g,'').replace(',','.'):text;
 const result=Number(normalized);
 return Number.isFinite(result)?result:NaN;
}
function spreadsheetDate(value){
 if(value instanceof Date&&!Number.isNaN(value.getTime()))return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
 if(typeof value==='number'&&window.XLSX){
  const parsed=XLSX.SSF.parse_date_code(value);
  if(parsed)return `${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
 }
 const text=String(value??'').trim();
 if(!text)return '';
 let match=text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
 if(match){
  const day=Number(match[1]),month=Number(match[2]),year=Number(match[3]);
  const date=new Date(year,month-1,day);
  if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day)return '';
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
 }
 match=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
 if(match){
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const date=new Date(year,month-1,day);
  if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day)return '';
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
 }
 return '';
}
function spreadsheetCell(row,headers,...names){
 const index=names.map(name=>headers.indexOf(name)).find(position=>position>=0);
 return index===undefined?'':row[index];
}
function parseSpreadsheetWorkbook(workbook,file){
 const sheetName=workbook.SheetNames[0];
 if(!sheetName)throw new Error('A planilha está vazia.');
 const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,raw:true,defval:''});
 if(!rows.length)throw new Error('A planilha está vazia.');
 const headers=rows[0].map(normalizeSpreadsheetHeader);
 const columns={
  name:headers.findIndex(value=>['produto','nomeproduto','nome'].includes(value)),
  category:headers.findIndex(value=>['categoria'].includes(value)),
  quantity:headers.findIndex(value=>['quantidade','qtd'].includes(value)),
  expiration:headers.findIndex(value=>['validade','datavalidade'].includes(value)),
  minimum:headers.findIndex(value=>['estoqueminimo','minimoestoque','estoquemin','minimo'].includes(value)),
  price:headers.findIndex(value=>['precounitario','preco','valorunitario'].includes(value)),
  unit:headers.findIndex(value=>['unidade','condominio'].includes(value))
 };
 const missing=Object.entries({name:'Produto',category:'Categoria',quantity:'Quantidade',expiration:'Validade',price:'Preço Unitário (ou Preço)'}).filter(([key])=>columns[key]<0).map(([,label])=>label);
 if(missing.length){
  const found=rows[0].map(value=>String(value??'').trim()).filter(Boolean);
  throw new Error(`Colunas obrigatórias ausentes: ${missing.join(', ')}. Colunas encontradas: ${found.length?found.join(', '):'nenhuma'}.`);
 }
 const productsRead=[];
 let errorCount=0;
 rows.slice(1).forEach((row,index)=>{
  if(row.every(value=>String(value??'').trim()===''))return;
  const name=String(row[columns.name]??'').trim();
  const category=String(row[columns.category]??'').trim();
  const quantity=spreadsheetNumber(row[columns.quantity]);
  const date=spreadsheetDate(row[columns.expiration]);
  const price=spreadsheetNumber(row[columns.price]);
  const minimumValue=columns.minimum<0||String(row[columns.minimum]??'').trim()===''?5:spreadsheetNumber(row[columns.minimum]);
  const unitName=columns.unit<0?'':String(row[columns.unit]??'').trim();
  const errors=[];
  if(!name)errors.push('produto vazio');
  if(!category)errors.push('categoria vazia');
  if(!Number.isFinite(quantity)||quantity<0)errors.push('quantidade inválida');
  if(!date)errors.push('validade inválida');
  if(!Number.isFinite(price)||price<0)errors.push('preço inválido');
  if(!Number.isFinite(minimumValue)||minimumValue<0)errors.push('estoque mínimo inválido');
  if(errors.length){errorCount++;return}
  productsRead.push({name,cat:category,qty:quantity,min:minimumValue,date,price,total:quantity*price,unitName,unitId:'',emoji:'📦',sourceFile:file.name,sourceRow:index+2});
 });
 return {file,products:productsRead,errorCount,errorMessage:''};
}
async function addSpreadsheetFiles(fileList){
 if(!isAdmin()){spreadsheetImportMessage='Somente um administrador pode importar planilhas.';renderSpreadsheetImport();return}
 const selected=Array.from(fileList||[]);
 const messages=[];
 spreadsheetImportMessage='';
 for(const file of selected){
  if(spreadsheetImports.length>=3){messages.push('Você pode anexar no máximo 3 planilhas.');break}
  const duplicate=spreadsheetImports.some(item=>item.file.name.toLowerCase()===file.name.toLowerCase()&&item.file.size===file.size&&item.file.lastModified===file.lastModified);
  if(duplicate){messages.push(`O arquivo "${file.name}" já foi anexado.`);continue}
  if(!/\.(xlsx|xls|csv)$/i.test(file.name)){messages.push(`"${file.name}" não é compatível. Selecione um arquivo .xlsx, .xls ou .csv.`);continue}
  if(file.size>5*1024*1024){messages.push(`"${file.name}" ultrapassa o limite de 5 MB.`);continue}
  try{
   if(!window.XLSX)throw new Error('A biblioteca de leitura de planilhas não está disponível.');
   const isCsv=/\.csv$/i.test(file.name);
   const workbook=XLSX.read(isCsv?await file.text():await file.arrayBuffer(),{type:isCsv?'string':'array',cellDates:true,raw:isCsv});
   spreadsheetImports.push(parseSpreadsheetWorkbook(workbook,file));
  }catch(error){
   spreadsheetImports.push({file,products:[],errorCount:1,errorMessage:error.message||'Não foi possível ler a planilha.'});
   messages.push(`Não foi possível ler "${file.name}": ${error.message||'arquivo inválido'}`);
  }
 }
 spreadsheetImportMessage=messages.join(' ');
 renderSpreadsheetImport();
}
function removeSpreadsheetFile(index){
 if(!isAdmin())return;
 spreadsheetImports.splice(index,1);
 spreadsheetImportMessage='';
 renderSpreadsheetImport();
}
function clearSpreadsheetFiles(){
 if(!isAdmin())return;
 spreadsheetImports=[];
 spreadsheetImportMessage='';
 renderSpreadsheetImport();
}
function downloadSpreadsheetTemplate(){
 if(!isAdmin())return;
 if(!window.XLSX){spreadsheetImportMessage='A biblioteca de planilhas não está disponível para gerar o modelo.';renderSpreadsheetImport();return}
 const sheet=XLSX.utils.aoa_to_sheet([['Produto','Categoria','Quantidade','Estoque mínimo','Validade','Preço Unitário','Preço Total','Unidade'],['Coca Cola Zero 1L','Bebidas',24,5,'2026-12-31',13,312,'Condomínio Freitas']]);
 sheet['!cols']=[{wch:28},{wch:20},{wch:14},{wch:16},{wch:16},{wch:18},{wch:16},{wch:26}];
 const workbook=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(workbook,sheet,'Produtos');
 XLSX.writeFile(workbook,'modelo_importacao_estoque.xlsx');
}
function productKey(product){return String(product.name||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function knownSpreadsheetUnitNames(item){
 return [...new Set(item.products.map(product=>String(product.unitName||'').trim()).filter(Boolean))];
}
function openSpreadsheetPreview(){
 if(!isAdmin()){alert('Somente um administrador pode importar planilhas.');return}
 if(!spreadsheetImports.some(item=>item.products.length)){spreadsheetImportMessage='Não há produtos válidos para pré-visualizar.';renderSpreadsheetImport();return}
 if(!units.length){spreadsheetImportMessage='Cadastre uma unidade antes de importar produtos.';renderSpreadsheetImport();return}
 pendingSpreadsheetDestinations=spreadsheetImports.map(item=>{
  const names=knownSpreadsheetUnitNames(item);
  const matched=names.length===1?units.find(unit=>normalizedUnitName(unit.name)===normalizedUnitName(names[0])):null;
  const selected=selectedUnitId();
  const unitId=matched?String(matched.id):selected!=='all'?selected:'';
  return {unitId};
 });
 $('#spreadsheetDestinationMessage').textContent='';
 $('#spreadsheetDestinationList').innerHTML=spreadsheetImports.map((item,index)=>{
  const names=knownSpreadsheetUnitNames(item);
  const unknown=names.filter(name=>!units.some(unit=>normalizedUnitName(unit.name)===normalizedUnitName(name)));
  const suggestion=names.length===1?units.find(unit=>normalizedUnitName(unit.name)===normalizedUnitName(names[0])):null;
  const options=units.map(unit=>`<option value="${escapeHTML(String(unit.id))}" ${pendingSpreadsheetDestinations[index].unitId===String(unit.id)?'selected':''}>${escapeHTML(unit.name)}</option>`).join('');
  const createOptions=unknown.map(name=>`<option value="create:${encodeURIComponent(name)}">Criar unidade: ${escapeHTML(name)}</option>`).join('');
  const note=unknown.length?`<p class="spreadsheet-destination-warning">Unidade '${escapeHTML(unknown.join(', '))}' não encontrada. Criar nova unidade ou escolher uma existente?</p>`:suggestion?`<p class="spreadsheet-destination-note">Unidade da planilha encontrada: ${escapeHTML(suggestion.name)}. Você pode confirmar ou escolher outra.</p>`:'';
  return `<div class="spreadsheet-destination-row"><label for="spreadsheetDestination${index}">${escapeHTML(item.file.name)}</label><select id="spreadsheetDestination${index}" class="filter-select" data-destination-index="${index}"><option value="">Selecione a unidade de destino</option>${options}${createOptions}</select>${note}</div>`;
 }).join('');
 $('#spreadsheetDestinationModal').classList.remove('hidden');
}
function continueSpreadsheetDestination(){
 if(!isAdmin()){alert('Somente um administrador pode importar planilhas.');return}
 const destinations=[];
 try{
  for(let index=0;index<spreadsheetImports.length;index++){
   const selector=$(`#spreadsheetDestination${index}`);
   const value=selector?.value||'';
   if(!spreadsheetImports[index].products.length){destinations.push({unitId:''});continue}
   if(value.startsWith('create:')){
    const name=decodeURIComponent(value.slice('create:'.length));
    const created=createUnit(name);
    destinations.push({unitId:String(created.id)});
    continue;
   }
   if(!units.some(unit=>String(unit.id)===value)){
    $('#spreadsheetDestinationMessage').textContent=`Selecione uma unidade válida para "${spreadsheetImports[index].file.name}".`;
    selector?.focus();
    return;
   }
   destinations.push({unitId:value});
  }
 }catch(error){
  $('#spreadsheetDestinationMessage').textContent=error.message||'Não foi possível preparar as unidades de destino.';
  return;
 }
 pendingSpreadsheetDestinations=destinations;
 pendingSpreadsheetProducts=spreadsheetImports.flatMap((item,index)=>{
  const unitId=destinations[index]?.unitId||'';
  const unit=units.find(candidate=>String(candidate.id)===unitId);
  return item.products.map(product=>({...product,unitId,unitName:unit?.name||''}));
 });
 save();
 updateUnitSelector();
 $('#spreadsheetDestinationModal').classList.add('hidden');
 const duplicates=spreadsheetDuplicateNames();
 const totals=spreadsheetSummary();
 const destinationNames=[...new Set(pendingSpreadsheetDestinations.filter(item=>item.unitId).map(item=>units.find(unit=>String(unit.id)===item.unitId)?.name).filter(Boolean))];
 $('#spreadsheetPreviewSummary').textContent=`${totals.valid} ${totals.valid===1?'produto válido':'produtos válidos'} · ${totals.errors} ${totals.errors===1?'com erro':'com erros'} · Destino${destinationNames.length===1?'':'s'}: ${destinationNames.join(', ')}`;
 $('#spreadsheetPreviewErrorBadge').textContent=`${totals.errors} ${totals.errors===1?'com erro':'com erros'}`;
 $('#spreadsheetPreviewErrorBadge').classList.toggle('hidden',totals.errors===0);
 $('#spreadsheetPreviewDuplicateSummary').textContent=duplicates.size?`${duplicates.size} produto(s) já existem nesta unidade ou aparecem mais de uma vez no mesmo destino.`:'';
 $('#spreadsheetPreviewDuplicateSummary').classList.toggle('hidden',duplicates.size===0);
 setSpreadsheetDuplicateChoice(duplicates.size?'':'ignore');
 renderSpreadsheetPreviewFile(0);
 $('#spreadsheetPreviewModal').classList.remove('hidden');
}
function spreadsheetDuplicateNames(){
 const scopedKey=product=>`${productUnitId(product)}::${productKey(product)}`;
 const seen=new Set(products.map(scopedKey));
 const duplicates=new Set();
 spreadsheetImports.forEach((item,index)=>item.products.forEach(product=>{
  const destination=pendingSpreadsheetDestinations[index]?.unitId||productUnitId(product);
  const key=`${destination}::${productKey(product)}`;
  if(seen.has(key))duplicates.add(key);
  seen.add(key);
 }));
 return duplicates;
}
function renderSpreadsheetPreviewFile(index){
 const item=spreadsheetImports[index];
 if(!item)return;
 activeSpreadsheetPreviewIndex=index;
 const destination=pendingSpreadsheetDestinations[index]?.unitId;
 const destinationName=units.find(unit=>String(unit.id)===String(destination))?.name||'Unidade não selecionada';
 $('#spreadsheetPreviewFilename').textContent=`${item.file.name} · Destino: ${destinationName}`;
 $('#spreadsheetPreviewTabs').innerHTML=spreadsheetImports.length>1?spreadsheetImports.map((file,fileIndex)=>`<button type="button" class="spreadsheet-preview-tab ${fileIndex===index?'active':''}" aria-selected="${fileIndex===index}" onclick="renderSpreadsheetPreviewFile(${fileIndex})" title="${escapeHTML(file.file.name)}">${escapeHTML(file.file.name)}${file.errorCount?` <span class="spreadsheet-preview-tab-error" title="${file.errorCount} linhas com erro">! ${file.errorCount}</span>`:''}</button>`).join(''):'';
 const tableRows=item.products.map(product=>{
  const unitName=destinationName;
  return `<tr><td class="preview-product-cell" title="${escapeHTML(product.name)}">${escapeHTML(product.name)}</td><td title="${escapeHTML(product.cat)}">${escapeHTML(product.cat)}</td><td class="preview-number-cell">${product.qty}</td><td class="preview-number-cell">${product.min}</td><td title="${new Date(`${product.date}T00:00:00`).toLocaleDateString('pt-BR')}">${new Date(`${product.date}T00:00:00`).toLocaleDateString('pt-BR')}</td><td class="preview-number-cell">${money(product.price)}</td><td class="preview-number-cell">${money(product.qty*product.price)}</td><td title="${escapeHTML(unitName)}">${escapeHTML(unitName)}</td></tr>`;
 }).join('');
 const fileError=item.errorMessage?`<p class="spreadsheet-preview-file-error" role="alert" title="${escapeHTML(item.errorMessage)}">⚠ ${escapeHTML(item.errorMessage)}</p>`:'';
 $('.spreadsheet-preview-table').innerHTML=`${fileError}<table class="table"><colgroup><col class="preview-col-product"><col class="preview-col-category"><col class="preview-col-quantity"><col class="preview-col-minimum"><col class="preview-col-date"><col class="preview-col-price"><col class="preview-col-total"><col class="preview-col-unit"></colgroup><thead><tr><th>Produto</th><th>Categoria</th><th>Qtd.</th><th>Est. mín.</th><th>Validade</th><th>Preço unit.</th><th>Total</th><th>Unidade</th></tr></thead><tbody>${tableRows||'<tr><td class="spreadsheet-preview-empty" colspan="8">Nenhum produto válido neste arquivo.</td></tr>'}</tbody></table>`;
}
function setSpreadsheetDuplicateChoice(value){
 $('#spreadsheetDuplicateMode').value=value;
 document.querySelectorAll('input[name="spreadsheetDuplicateChoice"]').forEach(input=>{input.checked=input.value===value});
}
function confirmSpreadsheetImport(){
 if(!isAdmin()){alert('Somente um administrador pode importar planilhas.');return}
 const duplicates=spreadsheetDuplicateNames();
 const mode=$('#spreadsheetDuplicateMode').value;
 if(duplicates.size&&!['sum','replace','ignore'].includes(mode)){
  $('#spreadsheetPreviewSummary').textContent='Escolha se deseja somar, substituir ou ignorar os produtos existentes.';
  $('#spreadsheetDuplicateMode').focus();
  return;
 }
 let added=0,updated=0,ignored=0;
 pendingSpreadsheetProducts.forEach((incoming,index)=>{
  const unitId=String(incoming.unitId||'');
  if(!units.some(unit=>String(unit.id)===unitId))return;
  const existing=products.find(product=>productUnitId(product)===unitId&&productKey(product)===productKey(incoming));
  const data={name:incoming.name,cat:incoming.cat,qty:incoming.qty,date:incoming.date,price:incoming.price,min:incoming.min,unitId,unidade_id:unitId,unitName:units.find(unit=>String(unit.id)===unitId)?.name||'',emoji:existing?.emoji||'📦'};
  if(existing){
   if(mode==='ignore'){ignored++;return}
   if(mode==='sum'){existing.qty=Number(existing.qty)+Number(incoming.qty);existing.cat=data.cat;existing.date=data.date;existing.price=data.price;existing.min=data.min;existing.unitId=unitId;existing.unidade_id=unitId;existing.unitName=data.unitName}
   else Object.assign(existing,data);
   updated++;
   return;
  }
  products.push({id:newClientId(),...data});
  added++;
 });
 const destinations=[...new Set(pendingSpreadsheetProducts.map(product=>String(product.unitId||'')).filter(Boolean))];
 save();
 spreadsheetImports=[];
 spreadsheetImportMessage=`Importação concluída: ${added} adicionados, ${updated} atualizados${ignored?`, ${ignored} ignorados`:''}.`;
 $('#spreadsheetPreviewModal').classList.add('hidden');
 $('#spreadsheetDestinationModal').classList.add('hidden');
 pendingSpreadsheetProducts=[];
 pendingSpreadsheetDestinations=[];
 localStorage.setItem('mf_selected_unit',destinations.length===1?destinations[0]:'all');
 localStorage.setItem('mf_report_unit',destinations.length===1?destinations[0]:'all');
 updateUnitSelector();
 render();
 renderSpreadsheetImport();
}
function filterStock(){drawStock()}
 function unitPage(){
 pageHeader('Unidades','Registre e acompanhe os pontos de mercado');
 const selectedStatus=localStorage.getItem('mf_unit_status_filter')||'Todos'; const filteredUnits=units.filter(unit=>selectedStatus==='Todos'||unit.status===selectedStatus);
 $('#content').innerHTML=`<div class="page"><div class="toolbar"><div><h3 class="section-title">Pontos de mercado</h3><span class="muted">Clique em uma unidade para administrar estoque, validade e financeiro daquele local.</span></div><div class="toolbar-actions"><select id="unitStatusFilter" class="filter-select" onchange="filterUnits()"><option value="Todos" ${selectedStatus==='Todos'?'selected':''}>Todos os status</option><option value="Ativo" ${selectedStatus==='Ativo'?'selected':''}>Ativo</option><option value="Em Manutenção" ${selectedStatus==='Em Manutenção'?'selected':''}>Em Manutenção</option><option value="Desativado" ${selectedStatus==='Desativado'?'selected':''}>Desativado</option></select><button class="primary" onclick="openUnitModal()">+ Adicionar unidade</button></div></div><div class="unit-grid">${filteredUnits.length?filteredUnits.map(unit=>`<section class="unit-card unit-card-clickable" onclick="unitDetail(${unit.id})"><div class="unit-card-header"><h3>${unit.name}</h3><span class="status ${unit.status==='Ativo'?'':'warn'}">${unit.status}</span></div><p><b>Local:</b> ${unit.location}</p><p><b>Torre / Bloco:</b> ${unit.block}</p><p><b>Responsável:</b> ${unit.manager}</p><div class="unit-card-footer"><span>Administrar unidade →</span><button class="secondary" onclick="event.stopPropagation();openUnitModal(${unit.id})">Editar</button></div></section>`).join(''):units.length?'<div class="empty-state">Nenhuma unidade encontrada para este status.</div>':'<div class="empty-state">Nenhuma unidade cadastrada. Comece adicionando um ponto de mercado.</div>'}</div></div>`;
}
function filterUnits(){localStorage.setItem('mf_unit_status_filter',$('#unitStatusFilter').value);unitPage()}
let editingUnitId=null;
function openUnitModal(unitId=null){editingUnitId=unitId;$('#unitModal').classList.remove('hidden');$('#unitForm').reset();const unit=units.find(item=>String(item.id)===String(unitId));if(unit){$('#unitName').value=unit.name;$('#unitLocation').value=unit.location;$('#unitBlock').value=unit.block;$('#unitManager').value=unit.manager;$('#unitStatus').value=unit.status;$('#unitModal h3').textContent='Editar unidade'}else $('#unitModal h3').textContent='Adicionar unidade'}
function removeUnit(id){if(products.some(product=>productUnitId(product)===String(id))){alert('Esta unidade ainda possui produtos vinculados. Transfira ou exclua os produtos antes de remover a unidade.');return}if(confirm('Excluir esta unidade?')){units=units.filter(unit=>String(unit.id)!==String(id));if(localStorage.getItem('mf_selected_unit')===String(id)){localStorage.setItem('mf_selected_unit','all');localStorage.setItem('mf_report_unit','all')}save();render()}}
function expiry(){
 const selectedUnit=selectedUnitId();const scopedProducts=products.filter(matchesSelectedUnit);const subtitle=selectedUnit==='all'?'Validades de todas as unidades':`Validades da unidade ${selectedUnitName()}`;pageHeader('Validade',subtitle);
 const query=($('#expirySearch')?.value??expirySearchQuery).trim().toLocaleLowerCase('pt-BR');
 expirySearchQuery=query;
 const matchesSearch=product=>!query||`${product.name||''} ${product.cat||''}`.toLocaleLowerCase('pt-BR').includes(query);
 const sortByExpiry=(left,right)=>daysTo(left.date)-daysTo(right.date)||String(left.name).localeCompare(String(right.name),'pt-BR');
 const groups=[
  {id:'today',title:'Vencendo hoje',icon:'🔴',products:scopedProducts.filter(product=>daysTo(product.date)===0).filter(matchesSearch).sort(sortByExpiry)},
  {id:'soon',title:'Próximos 7 dias',icon:'🟠',products:scopedProducts.filter(product=>daysTo(product.date)>0&&daysTo(product.date)<=7).filter(matchesSearch).sort(sortByExpiry)},
  {id:'normal',title:'Validade normal',products:scopedProducts.filter(product=>daysTo(product.date)>7).filter(matchesSearch).sort(sortByExpiry)}
 ];
 const compactRow=product=>`<div class="expiry-compact-row"><span class="expiry-compact-name" title="${escapeHTML(product.name)}">${product.emoji||'📦'} ${escapeHTML(product.name)}</span><span>${Number(product.qty)||0}</span><span>${new Date(`${product.date}T00:00:00`).toLocaleDateString('pt-BR')}</span><span>em ${daysTo(product.date)} dias</span></div>`;
 const miniCard=group=>`<section class="panel expiry-summary-card expiry-summary-${group.id}"><header class="expiry-summary-heading"><h3><i aria-hidden="true">${group.icon}</i>${group.title}</h3><strong>${group.products.length}</strong></header>${group.products.length?`<div class="expiry-mini-list">${group.products.slice(0,3).map(product=>`<div class="expiry-mini-row" title="${escapeHTML(product.name)}"><b>${product.emoji||'📦'} ${escapeHTML(product.name)}</b><span>Qtd. ${Number(product.qty)||0} · ${new Date(`${product.date}T00:00:00`).toLocaleDateString('pt-BR')}</span></div>`).join('')}</div>${group.products.length>3?`<button class="expiry-more-button" type="button" onclick="openExpiryCategory('${group.id}')">+ ${group.products.length-3} ${group.products.length===4?'produto':'produtos'}</button>`:''}`:'<p class="expiry-empty">Nenhum produto nesta categoria</p>'}</section>`;
 const normal=groups[2];
 $('#content').innerHTML=`<div class="page expiry-page"><div class="expiry-toolbar"><div><h3>Produtos por validade</h3><span class="muted">${selectedUnit==='all'?'Todas as unidades':escapeHTML(selectedUnitName())}</span></div><input id="expirySearch" class="search expiry-search" type="search" placeholder="🔎 Buscar produto..." aria-label="Buscar produtos por validade" value="${escapeHTML(query)}" oninput="filterExpiry()"></div><div class="expiry-summary-grid">${miniCard(groups[0])}${miniCard(groups[1])}</div><section class="panel expiry-normal-panel"><header class="expiry-normal-heading"><h3>Validade normal <span>· ${normal.products.length} ${normal.products.length===1?'produto':'produtos'}</span></h3></header><div class="expiry-normal-table-wrap"><div class="expiry-compact-row expiry-compact-header"><span>Produto</span><span>Quantidade</span><span>Validade</span><span>Vence em</span></div><div class="expiry-normal-list">${normal.products.length?normal.products.map(compactRow).join(''):'<p class="expiry-empty">Nenhum produto nesta categoria</p>'}</div></div></section></div><div id="expiryCategoryModal" class="modal hidden"><section class="modal-card expiry-category-modal" role="dialog" aria-modal="true" aria-labelledby="expiryCategoryTitle"><header><div><h3 id="expiryCategoryTitle"></h3><p id="expiryCategoryCount" class="muted"></p></div><button type="button" class="close" aria-label="Fechar" onclick="closeExpiryCategory()">×</button></header><div id="expiryCategoryList" class="expiry-category-list"></div></section></div>`;
 if(activeExpiryCategory)renderExpiryCategoryModal(groups.find(group=>group.id===activeExpiryCategory));
}
function filterExpiry(){
 const input=$('#expirySearch');
 expirySearchQuery=input?.value||'';
 const cursor=input?.selectionStart??expirySearchQuery.length;
 expiry();
 const nextInput=$('#expirySearch');
 nextInput?.focus();
 nextInput?.setSelectionRange(cursor,cursor);
}
function openExpiryCategory(category){activeExpiryCategory=category;expiry()}
function closeExpiryCategory(){activeExpiryCategory='';$('#expiryCategoryModal')?.classList.add('hidden')}
function renderExpiryCategoryModal(group){
 const modal=$('#expiryCategoryModal');if(!group||!modal)return;
 $('#expiryCategoryTitle').textContent=group.title;
 $('#expiryCategoryCount').textContent=`${group.products.length} ${group.products.length===1?'produto':'produtos'}`;
 $('#expiryCategoryList').innerHTML=group.products.map(product=>`<div class="expiry-modal-row"><div><b>${product.emoji||'📦'} ${escapeHTML(product.name)}</b><small>Quantidade: ${Number(product.qty)||0} · Validade: ${new Date(`${product.date}T00:00:00`).toLocaleDateString('pt-BR')}</small></div><strong>${daysTo(product.date)===0?'Hoje':`em ${daysTo(product.date)} dias`}</strong></div>`).join('')||'<p class="expiry-empty">Nenhum produto nesta categoria</p>';
 modal.classList.remove('hidden');
}
// Centraliza a conversão dos nomes usados no estoque para o Financeiro.
function mapearProdutoFinanceiro(product){
 return {
  id:product.id,
  name:String(product.name||'Produto'),
  category:String(product.cat||'Sem categoria'),
  quantity:Number.isFinite(Number(product.qty))?Number(product.qty):0,
  unitPrice:Number.isFinite(Number(product.price))?Number(product.price):0,
  unitId:productUnitId(product),
  unitName:productUnitName(product)
 };
}
function valorTotalPorCategoria(financeProducts){
 const categories=new Map();
 financeProducts.forEach(product=>{
  const category=categories.get(product.category)||{category:product.category,productCount:0,units:0,value:0};
  category.productCount++;
  category.units+=product.quantity;
  category.value+=product.quantity*product.unitPrice;
  categories.set(product.category,category);
 });
 return [...categories.values()].sort((left,right)=>left.category.localeCompare(right.category,'pt-BR'));
}
function finance(){
 const selectedUnit=selectedUnitId();
 const unitLabel=selectedUnit==='all'?'todas as unidades':selectedUnitName();
 pageHeader('Financeiro',`Estoque e saídas de ${unitLabel}`);
 const financeProducts=products.filter(matchesSelectedUnit).map(mapearProdutoFinanceiro);
 const categoryTotals=valorTotalPorCategoria(financeProducts);
 const stockValue=categoryTotals.reduce((total,category)=>total+category.value,0);
 const scopedExits=transactions.filter(transaction=>matchesSelectedUnit(transaction)&&transaction.type==='Saída');
 const exitValue=scopedExits.reduce((total,transaction)=>total+Math.abs(Number(transaction.value)||0),0);
 const exitQuantity=scopedExits.reduce((total,transaction)=>total+Math.max(0,Number(transaction.qty??transaction.quantity)||0),0);
 const totalUnits=categoryTotals.reduce((total,category)=>total+category.units,0);
 const tableRows=categoryTotals.map(category=>{
  return `<tr><td>${escapeHTML(category.category)}</td><td>${category.productCount}</td><td>${category.units}</td><td>${money(category.value)}</td></tr>`;
 }).join('');
 const defaultExitUnit=selectedUnit==='all'?'':selectedUnit;
 const unitOptionsHTML=units.map(unit=>`<option value="${escapeHTML(String(unit.id))}" ${defaultExitUnit===String(unit.id)?'selected':''}>${escapeHTML(unit.name)}</option>`).join('');
 const movementRows=transactions.map((transaction,index)=>({transaction,index})).filter(({transaction})=>matchesSelectedUnit(transaction)&&transaction.type==='Saída').map(({transaction,index})=>{
  const date=transactionDateTime(transaction);
  const displayDate=date?date.toLocaleString('pt-BR'):'—';
  return `<tr><td>${escapeHTML(displayDate)}</td><td>${escapeHTML(transaction.desc||'Saída registrada')}</td><td>Saída</td><td>${escapeHTML(transaction.formaPagamento||'—')}</td><td class="value-exit">${money(Math.abs(Number(transaction.value)||0))}</td><td><button class="danger-button delete-transaction-button" type="button" data-delete-transaction="${index}" aria-label="Excluir movimentação: ${escapeHTML(transaction.desc||'Saída registrada')}">Excluir</button></td></tr>`;
 }).join('');
 $('#content').innerHTML=`<div class="page finance-page"><div class="metric-grid finance-kpis"><div class="metric"><strong>${money(stockValue)}</strong><span>Valor total em estoque</span></div><div class="metric"><strong>${categoryTotals.length}</strong><span>Quantidade de categorias</span></div><div class="metric"><strong>${money(exitValue)}</strong><span>Valor total das saídas</span><small>${exitQuantity.toLocaleString('pt-BR')} ${exitQuantity===1?'unidade saiu':'unidades saíram'}</small></div></div><section class="panel finance-section"><h3>Valor do estoque por categoria</h3>${financeProducts.length?`<div class="table-wrap"><table class="table finance-table"><thead><tr><th>Categoria</th><th>Nº de produtos</th><th>Nº de unidades</th><th>Valor total</th></tr></thead><tbody>${tableRows}<tr class="finance-total-row"><th>TOTAL GERAL</th><th>${financeProducts.length}</th><th>${totalUnits}</th><th>${money(stockValue)}</th></tr></tbody></table></div>`:'<p class="empty-state finance-empty-stock">Anexe a planilha deste condomínio na aba Estoque.</p>'}</section></div>`;
 $('#content').querySelectorAll('[data-delete-transaction]').forEach(button=>button.addEventListener('click',()=>deleteFinanceTransaction(Number(button.dataset.deleteTransaction))));
}
function deleteFinanceTransaction(index){
 const transaction=transactions[index];
 if(!transaction||transaction.type!=='Saída')return;
 if(!confirm('Tem certeza que deseja excluir esta movimentação? Esta ação não pode ser desfeita.'))return;
 transactions.splice(index,1);
 save();
 finance();
}
function registerFinanceExit(event){
 event.preventDefault();
 const unitId=$('#financeExitUnit').value;
 const unit=units.find(item=>String(item.id)===unitId);
 if(!unit){$('#financeExitUnit').setCustomValidity('Selecione o ponto de venda da saída.');$('#financeExitUnit').reportValidity();return}
 $('#financeExitUnit').setCustomValidity('');
 const now=new Date();
 transactions.unshift({
  date:now.toLocaleDateString('pt-BR'),
  createdAt:now.toISOString(),
  desc:$('#financeExitDescription').value.trim(),
  type:'Saída',
  value:Number($('#financeExitValue').value),
  formaPagamento:$('#financeExitPayment').value,
  unitId:String(unit.id),
  unidade_id:String(unit.id),
  unit:unit.name
 });
 save();
 finance();
}
function auto(){
 pageHeader('Autoatendimento','Simule a compra do cliente');
 const catalog=products.filter(matchesSelectedUnit).slice(0,6);
 $('#content').innerHTML=`<div class="page"><div class="auto-grid"><section><div class="toolbar"><input id="searchAuto" class="search" placeholder="🔎 Buscar produto..." oninput="filterAuto()"></div><div id="catalog" class="products-grid"></div></section><section class="panel cart"><h3>🛒 Meu carrinho</h3><div id="cart"></div></section></div></div>`;drawCatalog(catalog);drawCart();
}
function drawCatalog(list=products.filter(matchesSelectedUnit)){
 const q=($('#searchAuto')?.value||'').toLowerCase();list=list.filter(p=>p.name.toLowerCase().includes(q));
 $('#catalog').innerHTML=list.map(p=>`<div class="product"><div class="product-img">${p.emoji||'📦'}</div><h4>${p.name}</h4><div class="price">${money(p.price)}</div><button onclick="addCart(${p.id})">+ Adicionar</button></div>`).join('');
}
function filterAuto(){drawCatalog(products.filter(matchesSelectedUnit))}
function addCart(id){const p=products.find(x=>x.id===id);let c=cart.find(x=>x.id===id);if(c)c.qty++;else cart.push({id,qty:1});drawCart()}
function drawCart(){if(!$('#cart'))return;const total=cart.reduce((a,c)=>{const p=products.find(x=>x.id===c.id);return a+p.price*c.qty},0);$('#cart').innerHTML=cart.length?cart.map(c=>{const p=products.find(x=>x.id===c.id);return `<div class="cart-row"><span>${p.name}<br><small>${c.qty} x ${money(p.price)}</small></span><b>${money(p.price*c.qty)}</b></div>`}).join('')+`<div class="total"><span>Total</span><span>${money(total)}</span></div><button class="primary full" onclick="finishSale()">Finalizar compra</button>`:'<p class="muted" style="padding:20px 0">Seu carrinho está vazio.</p>'}
function finishSale(){if(!cart.length)return;const total=cart.reduce((a,c)=>a+products.find(p=>p.id===c.id).price*c.qty,0);const cartUnitIds=[...new Set(cart.map(item=>productUnitId(products.find(product=>product.id===item.id))).filter(Boolean))];const unitId=cartUnitIds.length===1?cartUnitIds[0]:'';const unit=units.find(item=>String(item.id)===unitId);transactions.unshift({date:new Date().toLocaleDateString('pt-BR'),createdAt:new Date().toISOString(),desc:'Venda do autoatendimento',type:'Entrada',value:total,unitId,unidade_id:unitId,unit:unit?.name||'',items:cart.map(c=>{const product=products.find(item=>item.id===c.id);return {name:product.name,qty:c.qty,price:product.price}})});cart.forEach(c=>{const p=products.find(x=>x.id===c.id);p.qty=Math.max(0,p.qty-c.qty)});cart=[];save();alert('Compra finalizada com sucesso!');drawCart();drawCatalog(products.filter(matchesSelectedUnit))}
function notificationChannels(){return notificationChannelList}
function config(){
 if(isStaffProfile()){employeeSettingsPage();return}
 pageHeader('Configurações','Preferências do seu sistema');
 const channels=notificationChannels();
 const channelRows=channels.length?channels.map((channel,index)=>{
  const unit=units.find(item=>String(item.id)===String(channel.unitId));
  const contact=channel.channel==='WhatsApp'?(channel.phone||''):(channel.email||'');
  return `<div class="notification-channel-row"><div><b>${escapeHTML(unit?.name||'Todos os condomínios')}</b><p class="muted">${escapeHTML(channel.channel||'E-mail')} · ${escapeHTML(contact)}</p></div><button class="secondary" type="button" onclick="removeNotificationChannel(${index})">Remover</button></div>`;
 }).join(''):'<p class="muted notification-empty">Nenhum canal de notificação cadastrado.</p>';
 $('#content').innerHTML=`<div class="page settings-page"><section class="config-box"><h3>Configurações do sistema</h3><div class="config-row"><div><b>Alertas de validade</b><p class="muted">Receber alertas de produtos próximos do vencimento.</p></div><div class="switch on"></div></div><div class="config-row"><div><b>Alertas de estoque baixo</b><p class="muted">Avisar quando um produto atingir o estoque mínimo.</p></div><div class="switch on"></div></div></section><section class="config-box notification-settings"><h3>Canais de notificações</h3><p class="muted">Escolha como deseja receber notificações, para qual condomínio e informe o contato.</p><form id="notificationChannelForm"><div class="notification-channel-form"><div><label for="notificationUnit">Condomínio</label><select id="notificationUnit"><option value="all">Todos os condomínios</option>${units.map(unit=>`<option value="${escapeHTML(unit.id)}">${escapeHTML(unit.name)}</option>`).join('')}</select></div><div><label for="notificationChannel">Canal de notificação</label><select id="notificationChannel"><option value="E-mail">E-mail</option><option value="WhatsApp">WhatsApp</option></select></div><div><label id="notificationContactLabel" for="notificationContact">E-mail para notificações</label><input id="notificationContact" type="email" placeholder="nome@exemplo.com" required></div><button class="primary" type="submit">Salvar canal</button></div><p id="notificationMessage" class="notification-message" role="status"></p></form><div id="notificationChannelList" class="notification-channel-list">${channelRows}</div><p class="muted notification-delivery-note">Os canais ficam salvos neste navegador. O envio automático de e-mails ou mensagens de WhatsApp requer integração com um serviço de notificações.</p></section></div>`;
 $('#notificationChannelForm').addEventListener('submit',saveNotificationChannel);
 $('#notificationChannel').addEventListener('change',updateNotificationContactField);
 updateNotificationContactField();
}
function employeeSettingsPage(){
 const profile=profiles.find(item=>String(item.id)===String(currentUser?.id))||currentUser||{};
 pendingEmployeePhoto=profile.photo||'';
 const unit=units.find(item=>String(item.id)===String(profile.unitId||''));
 pageHeader('Configurações','Seu perfil, informações de contato e vínculo de trabalho');
 $('#content').innerHTML=`<div class="page employee-settings-page">
  <section class="config-box employee-profile-card">
   <header class="employee-settings-heading"><div><h2>Meu perfil</h2><p>Atualize sua foto e suas informações de contato.</p></div></header>
   <form id="employeeSettingsForm">
    <div class="employee-photo-editor"><div class="employee-profile-avatar" id="employeePhotoPreview">${profile.photo?`<img src="${escapeHTML(profile.photo)}" alt="Foto de perfil">`:escapeHTML((profile.name||'?').split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase())}</div><div><label class="employee-upload-button" for="employeePhoto">Alterar foto de perfil</label><input id="employeePhoto" class="employee-photo-input" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="employeePhotoHint"><button id="removeEmployeePhoto" class="employee-remove-photo ${profile.photo?'':'hidden'}" type="button">Remover foto</button><small id="employeePhotoHint">JPG, PNG ou WebP; até 5 MB.</small></div></div>
    <h3 class="employee-settings-section-title">Informações pessoais</h3>
    <div class="employee-settings-fields"><div><label for="employeeEmail">E-mail pessoal</label><input id="employeeEmail" type="email" autocomplete="email" value="${escapeHTML(profile.email||'')}" required></div><div><label for="employeePhone">Telefone de contato</label><input id="employeePhone" type="tel" autocomplete="tel" value="${escapeHTML(profile.phone||'')}"></div><div class="employee-address-field"><label for="employeeAddress">Endereço</label><input id="employeeAddress" type="text" autocomplete="street-address" value="${escapeHTML(profile.address||'')}" placeholder="Rua, número, bairro, cidade"></div></div>
    <p id="employeeSettingsMessage" class="employee-settings-message" role="status"></p><button class="primary" type="submit">Salvar informações</button>
   </form>
  </section>
  <section class="config-box employee-contract-card"><header class="employee-settings-heading"><div><h2>Contrato e cargo</h2><p>Informações do seu vínculo de trabalho. Somente leitura.</p></div><span class="employee-readonly-badge">Somente leitura</span></header>
   <dl class="employee-contract-grid"><div><dt>Cargo</dt><dd>${escapeHTML(profile.jobTitle||'Não informado')}</dd></div><div><dt>Matrícula</dt><dd>${escapeHTML(profile.registration||'Não informada')}</dd></div><div><dt>Turno de trabalho</dt><dd>${escapeHTML(profile.shift||'Não informado')}</dd></div><div><dt>Unidade</dt><dd>${escapeHTML(unit?.name||profile.department||'Não informada')}</dd></div><div><dt>Departamento</dt><dd>${escapeHTML(profile.department||'Não informado')}</dd></div></dl>
  </section>
 </div>`;
 $('#employeeSettingsForm').addEventListener('submit',saveEmployeeSettings);
 $('#employeePhoto').addEventListener('change',async event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  try{
   pendingEmployeePhoto=await readProfilePhoto(file);
   $('#employeePhotoPreview').innerHTML=`<img src="${escapeHTML(pendingEmployeePhoto)}" alt="Foto de perfil">`;
   $('#removeEmployeePhoto').classList.remove('hidden');
   $('#employeeSettingsMessage').textContent='';
  }catch(error){
   event.target.value='';
   $('#employeeSettingsMessage').textContent=error.message||'Não foi possível carregar a foto.';
  }
 });
 $('#removeEmployeePhoto').addEventListener('click',()=>{
  pendingEmployeePhoto='';
  $('#employeePhoto').value='';
  $('#employeePhotoPreview').textContent=(profile.name||'?').split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase();
  $('#removeEmployeePhoto').classList.add('hidden');
 });
}
function saveEmployeeSettings(event){
 event.preventDefault();
 if(!isStaffProfile()){alert('Esta área é exclusiva do perfil de funcionário.');return}
 const profile=profiles.find(item=>String(item.id)===String(currentUser?.id));
 if(!profile){$('#employeeSettingsMessage').textContent='Não foi possível localizar seu perfil. Entre novamente ou fale com um administrador.';return}
 const email=$('#employeeEmail').value.trim().toLowerCase();
 if(!$('#employeeEmail').checkValidity()){$('#employeeEmail').reportValidity();return}
 if(profiles.some(item=>String(item.id)!==String(profile.id)&&String(item.email||'').toLowerCase()===email)){
  $('#employeeSettingsMessage').textContent='Este e-mail já está associado a outro perfil.';
  $('#employeeEmail').focus();
  return;
 }
 profile.email=email;
 profile.phone=$('#employeePhone').value.trim();
 profile.address=$('#employeeAddress').value.trim();
 profile.photo=pendingEmployeePhoto;
 currentUser={...currentUser,...profile};
 localStorage.setItem('mf_current_user',JSON.stringify(currentUser));
 persistProfiles();
 $('#userEmail').textContent=profile.email;
 setUserAvatar($('#userAvatar'),profile,(profile.name||'?').charAt(0).toUpperCase());
 const initials=(profile.name||'MF').split(/\s+/).slice(0,2).map(part=>part.charAt(0)).join('').toUpperCase();
 setUserAvatar($('#topbarAvatar'),profile,initials);
 $('#removeEmployeePhoto').classList.toggle('hidden',!profile.photo);
 $('#employeeSettingsMessage').textContent='Suas informações foram salvas.';
}
function updateNotificationContactField(){
 const isWhatsApp=$('#notificationChannel').value==='WhatsApp';
 $('#notificationContactLabel').textContent=isWhatsApp?'Número para notificações':'E-mail para notificações';
 $('#notificationContact').type=isWhatsApp?'tel':'email';
 $('#notificationContact').placeholder=isWhatsApp?'+55 (11) 99999-9999':'nome@exemplo.com';
 $('#notificationContact').inputMode=isWhatsApp?'tel':'email';
 $('#notificationContact').value='';
 $('#notificationMessage').textContent='';
}
function saveNotificationChannel(event){
 event.preventDefault();
 const channelType=$('#notificationChannel').value;
 const contact=$('#notificationContact').value.trim();
 const isWhatsApp=channelType==='WhatsApp';
 const digits=contact.replace(/\D/g,'');
 if(isWhatsApp&&(digits.length<10||digits.length>13)){
  $('#notificationMessage').textContent='Informe um número de telefone válido, incluindo o DDD.';
  $('#notificationContact').focus();
  return;
 }
 if(!isWhatsApp&&!$('#notificationContact').checkValidity()){$('#notificationContact').reportValidity();return}
 const unitId=$('#notificationUnit').value;
 const channels=notificationChannels();
 const channel={unitId:unitId==='all'?'all':unitId,channel:channelType,...(isWhatsApp?{phone:contact}:{email:contact.toLowerCase()})};
 const existingIndex=channels.findIndex(item=>String(item.unitId)===String(channel.unitId)&&item.channel===channel.channel);
 if(existingIndex>=0)channels[existingIndex]={...channels[existingIndex],...channel};
 else channels.push(channel);
 save();
 config();
 $('#notificationUnit').value=unitId;
 $('#notificationChannel').value=channelType;
 updateNotificationContactField();
 $('#notificationMessage').textContent='Canal de notificação salvo.';
}
function removeNotificationChannel(index){
 const channels=notificationChannels();
 if(!channels[index])return;
 channels.splice(index,1);
 save();
 config();
}
function go(page){if(!canAccessPage(page)){alert('Você não tem permissão para acessar esta área.');page='dashboard'}document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===page));render();if(innerWidth<760)document.querySelector('.sidebar').classList.remove('open')}
function openModal(){
 $('#modal').classList.remove('hidden');
 $('#productForm').reset();
 $('#pUnit').innerHTML=`<option value="">${units.length?'Selecione uma unidade':'Nenhuma unidade cadastrada'}</option>`+units.map(unit=>`<option value="${escapeHTML(String(unit.id))}">${escapeHTML(unit.name)}</option>`).join('');
 const preferredUnit=selectedUnitId();
 if(preferredUnit&&units.some(unit=>String(unit.id)===String(preferredUnit)))$('#pUnit').value=preferredUnit;
}
function openModalForUnit(unitId){openModal();$('#pUnit').value=unitId}
function removeProduct(id){if(confirm('Excluir este produto?')){products=products.filter(p=>p.id!==id);selectedStockProductIds.delete(String(id));save();drawStock();}}
function setAuthMode(mode){
 const signup=mode==='signup';
 document.querySelectorAll('[data-auth-mode]').forEach(button=>button.classList.toggle('active',button.dataset.authMode===mode));
 $('#nameField').classList.toggle('hidden',!signup);$('#name').required=signup;
 $('#password').autocomplete=signup?'new-password':'current-password';
 $('#authSubmit').innerHTML=signup?'＋ &nbsp; Criar minha conta':'⇥ &nbsp; Entrar';
 $('#forgotPassword').classList.toggle('hidden',signup);$('#authMessage').textContent='';
}
function showApp(user){
 const profile=profiles.find(item=>item.email===user.email);
 currentUser={...user,...profile,id:profile?.id||user.id,profileType:normalizedProfileType(profile||user),status:profile?.status||user.status||'active'};
 if(!isProfileActive(currentUser)){alert(`Este perfil está ${profileStatusLabel(currentUser.status).toLowerCase()}. Fale com um administrador.`);return}
 localStorage.setItem('mf_current_user',JSON.stringify(currentUser));
 $('#userName').textContent=currentUser.name;$('#userEmail').textContent=currentUser.email;setUserAvatar($('#userAvatar'),currentUser,currentUser.name.charAt(0).toUpperCase());
 $('#loginScreen').classList.add('hidden');$('#app').classList.remove('hidden');render();
}
document.querySelectorAll('[data-auth-mode]').forEach(button=>button.addEventListener('click',()=>setAuthMode(button.dataset.authMode)));
function mapProfileRow(row){
 return {id:row.id,name:row.name,email:row.email,phone:row.phone||'',photo:row.photo||'',jobTitle:row.job_title||'',registration:row.registration||'',shift:row.shift||'',department:row.department||'',address:row.address||'',unitId:row.unit_id?String(row.unit_id):'',profileType:row.profile_type,status:row.status,createdAt:row.created_at};
}
async function startSession(authUser){
 try{await loadDataFromSupabase()}catch(error){
  console.error(error);dataLoaded=false;await sb.auth.signOut();
  $('#authMessage').textContent=`Não foi possível carregar os dados: ${error.message||error}`;return false;
 }
 const profile=profiles.find(item=>String(item.id)===String(authUser.id));
 if(!profile){dataLoaded=false;await sb.auth.signOut();$('#authMessage').textContent='Perfil não encontrado. Fale com um administrador.';return false}
 if(!isProfileActive(profile)){dataLoaded=false;await sb.auth.signOut();$('#authMessage').textContent=`Este perfil está ${profileStatusLabel(profile.status).toLowerCase()}. Fale com um administrador.`;return false}
 subscribeRealtime();
 showApp(profile);return true;
}
$('#loginForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const message=$('#authMessage');
 if(!$('#nameField').classList.contains('hidden')){message.textContent='Somente o administrador pode cadastrar novos perfis pela área Gerenciar Perfis.';return}
 const email=$('#email').value.trim().toLowerCase();const password=$('#password').value;
 const button=$('#authSubmit');button.disabled=true;message.textContent='Entrando...';
 const {data,error}=await sb.auth.signInWithPassword({email,password});
 if(error){message.textContent=error.message==='Invalid login credentials'?'E-mail ou senha incorretos.':`Não foi possível entrar: ${error.message}`;button.disabled=false;return}
 message.textContent='';
 await startSession(data.user);
 button.disabled=false;
});
$('#forgotPassword').addEventListener('click',openResetModal);
$('#logout').addEventListener('click',async()=>{await syncQueue;unsubscribeRealtime();await sb.auth.signOut();dataLoaded=false;units=[];products=[];transactions=[];profiles=[];staffTasks=[];staffNotices=[];notificationChannelList=[];localStorage.removeItem('mf_current_user');currentUser=null;$('#app').classList.add('hidden');$('#loginScreen').classList.remove('hidden');$('#loginForm').reset();setAuthMode('login')});
document.querySelectorAll('.nav-item').forEach(n=>n.addEventListener('click',()=>go(n.dataset.page)));
$('#togglePassword').addEventListener('click',()=>$('#password').type=$('#password').type==='password'?'text':'password');
$('#closeModal').addEventListener('click',()=>$('#modal').classList.add('hidden'));
$('#closeUnitModal').addEventListener('click',()=>$('#unitModal').classList.add('hidden'));
$('#closeResetModal').addEventListener('click',()=>$('#resetModal').classList.add('hidden'));
$('#closeProfileModal').addEventListener('click',()=>$('#profileModal').classList.add('hidden'));
$('#closeSpreadsheetPreview').addEventListener('click',()=>$('#spreadsheetPreviewModal').classList.add('hidden'));
$('#cancelSpreadsheetImport').addEventListener('click',()=>$('#spreadsheetPreviewModal').classList.add('hidden'));
$('#confirmSpreadsheetImport').addEventListener('click',confirmSpreadsheetImport);
document.querySelectorAll('input[name="spreadsheetDuplicateChoice"]').forEach(input=>input.addEventListener('change',event=>setSpreadsheetDuplicateChoice(event.target.value)));
$('#profilePhoto').addEventListener('change',async event=>{
 const file=event.target.files?.[0];
 if(!file)return;
 try{
  pendingProfilePhoto=await readProfilePhoto(file);
  updateProfilePhotoPreview(pendingProfilePhoto);
  $('#profileFormMessage').textContent='';
 }catch(error){
  event.target.value='';
  $('#profileFormMessage').textContent=error.message;
 }
});
$('#removeProfilePhoto').addEventListener('click',()=>{
 pendingProfilePhoto='';
 $('#profilePhoto').value='';
 updateProfilePhotoPreview('');
});
$('#mobileMenu').addEventListener('click',()=>document.querySelector('.sidebar').classList.toggle('open'));
$('#productForm').addEventListener('submit',e=>{e.preventDefault();const unitId=$('#pUnit').value;if(!units.some(unit=>String(unit.id)===unitId)){$('#pUnit').setCustomValidity('Selecione a unidade de destino do produto.');$('#pUnit').reportValidity();return}$('#pUnit').setCustomValidity('');products.push({id:Date.now(),name:$('#pName').value.trim(),cat:$('#pCat').value,qty:+$('#pQty').value,min:+$('#pMin').value,date:$('#pDate').value,price:+$('#pPrice').value,unitId,unidade_id:unitId,emoji:'📦'});save();$('#modal').classList.add('hidden');render()});
$('#pUnit').addEventListener('change',()=>$('#pUnit').setCustomValidity(''));
$('#unitForm').addEventListener('submit',e=>{e.preventDefault();const data={name:$('#unitName').value.trim(),location:$('#unitLocation').value.trim(),block:$('#unitBlock').value.trim(),manager:$('#unitManager').value.trim(),status:$('#unitStatus').value};if(editingUnitId){const unit=units.find(item=>String(item.id)===String(editingUnitId));if(unit)Object.assign(unit,data)}else createUnit(data.name,data);editingUnitId=null;save();$('#unitModal').classList.add('hidden');updateUnitSelector();render()});
$('#resetForm').addEventListener('submit',resetPasswordFlow);
$('#profileForm').addEventListener('submit',saveProfile);
$('#unitSelector').addEventListener('change',e=>{const selected=units.length?e.target.value:'all';localStorage.setItem('mf_selected_unit',selected);localStorage.setItem('mf_report_unit',selected);render()});
function closeSpreadsheetDestinationModal(){ $('#spreadsheetDestinationModal').classList.add('hidden') }
$('#closeSpreadsheetDestination').addEventListener('click',closeSpreadsheetDestinationModal);
$('#cancelSpreadsheetDestination').addEventListener('click',closeSpreadsheetDestinationModal);
$('#continueSpreadsheetDestination').addEventListener('click',continueSpreadsheetDestination);
$('#headerProductSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){go('estoque');$('#searchStock').value=e.target.value.trim();filterStock()}});
const IS_RECOVERY_LINK=/type=recovery/.test(window.location.hash);
const RECOVERY_LINK_ERROR=/error(_code)?=/.test(window.location.hash);
(async()=>{
 if(IS_RECOVERY_LINK){openRecoveryModal();return}
 if(RECOVERY_LINK_ERROR){$('#authMessage').textContent='O link de redefinição expirou ou é inválido. Peça um novo em “Esqueci minha senha”.';history.replaceState(null,'',window.location.pathname)}
 const {data}=await sb.auth.getSession();
 if(data.session)await startSession(data.session.user);
})();
