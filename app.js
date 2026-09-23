import { readiness, criteria, stages, recommend } from './core.mjs';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const escapeHTML = (s = '') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e = escapeHTML;
const state = { me: null, tasks: [], proposals: [], milestones: [], view: 'home', draft: null, fields: {}, answers: {}, questions: [], dirty: false, briefOpen: false, activeTask: null, ownedTask: '', selections: new Set(), authMode:'register', authMethod:'email', afterAuth:null };
const formIds = { title:'taskTitle', problem:'taskProblem', audience:'taskAudience', category:'taskCategory', data:'taskData', deadline:'taskDeadline', result:'taskResult' };
const names = Object.fromEntries(criteria.map(([key,label])=>[key,label]));
Object.assign(names, {title:'Название задачи', category:'Сфера', data:'Наличие данных', deadline:'Срок', owner:'Кто принимает результат', contact:'Контакт бизнеса (будет виден в каталоге)', consultation:'Формат консультаций', feedback:'Порядок обратной связи', scope:'Границы первой версии', validation:'Как проверить решение', risks:'Риски'});
const statuses = { review:'На рассмотрении', accepted:'Выбрана бизнесом', rejected:'Не выбрана', withdrawn:'Отклик отозван' };
const date = value => new Date(value).toLocaleDateString('ru-RU');
function showToast(message) {
  $('#toast p').textContent=message; $('#toast').classList.add('show');
  clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4000);
}
async function api(path, body) {
  const res=await fetch('/api/'+path, body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await res.json().catch(()=>({error:'Сервер недоступен. Запустите сайт через npm start.'}));
  if(!res.ok) throw new Error(result.error || 'Не удалось выполнить действие');
  return result;
}
async function perform(button, action) {
  if(button?.disabled) return;
  if(button) button.disabled=true;
  try { await action(); } catch(error) { showToast(error.message); }
  finally { if(button) button.disabled=false; syncDraftButtons(); }
}
async function refresh() {
  try {
    const snapshot=await api('state'); Object.assign(state,snapshot);
    $('#connectionError').classList.add('hidden');
    renderCatalog(); renderProfile(); renderResponses(); renderAccess();
  } catch(error) { $('#connectionError').classList.remove('hidden'); throw error; }
}
$('#retryConnection').onclick=()=>perform($('#retryConnection'),refresh);
function showView(name) {
  state.view=name;
  $$('.view').forEach(v=>v.classList.toggle('active',v.dataset.viewPanel===name));
  $$('.nav-tab').forEach(v=>v.classList.toggle('active',v.dataset.view===name));
  if(name==='responses') perform(null,refresh);
  if(name==='profile') renderProfile();
  window.scrollTo({top:0,behavior:'smooth'});
}
document.addEventListener('click',event=>{
  const nav=event.target.closest('.nav-trigger,.nav-tab'); if(nav) showView(nav.dataset.view);
});
function renderAccess() {
  const box=$('#createAccess');
  const allowed=state.me?.role==='Бизнес';
  box.classList.toggle('hidden',allowed);
  box.textContent=state.me ? 'Создание и публикация задач доступны профилю бизнеса. Роль можно изменить в профиле.' : 'Заполнить черновик можно сейчас. Для сохранения и публикации войдите как бизнес.';
}
function readBaseFields() { Object.entries(formIds).forEach(([key,id])=>{state.fields[key]=$('#'+id).value.trim();}); return state.fields; }
function syncBaseFields() { Object.entries(formIds).forEach(([key,id])=>{$('#'+id).value=state.fields[key] || '';}); }
function draftChanged() {
  state.dirty=true;
  if(state.draft) state.draft.status='draft';
  renderScore(); syncDraftButtons();
}
function syncDraftButtons() {
  const answered=state.questions.filter(q=>(state.answers[q.key] || '').trim().length>=10).length;
  $('#buildBriefBtn').disabled=answered<3;
  const confirmed=state.draft?.status==='confirmed' && !state.dirty;
  $('#publishBtn').disabled=!confirmed;
  $('#confirmBriefBtn').disabled=confirmed;
  $('#confirmBriefBtn').textContent=confirmed?'Карточка подтверждена ✓':'✓ Подтвердить карточку';
}
function renderScore() {
  const confirmed=state.draft?.status==='confirmed' && !state.dirty;
  const {score,potential,rows}=readiness(state.fields,confirmed);
  $('#readinessScore').textContent=score; $('#scoreCircle span').textContent=score+'%';
  $('#readinessProgress').style.width=score+'%';
  $('#scoreCircle').style.background='radial-gradient(closest-side,#fff 74%,transparent 76% 99%),conic-gradient(var(--purple) '+score+'%,#ececf3 0)';
  $('#scoreCriteria').innerHTML=rows.map(r=>'<div class="'+(r.confirmed?'complete':'')+'"><span>'+e(r.label)+'</span><b>'+(r.confirmed?'✓ '+r.points:r.complete?'Готово · '+r.points:'+'+r.points)+'</b></div>').join('');
  const missing=rows.filter(r=>!r.complete);
  $('#readinessLabel').textContent=confirmed?'Подтверждённый рейтинг: '+score+'/100.': 'Сейчас подтверждено 0 баллов. После проверки карточки можно получить '+potential+'/100.';
  $('#aiTipText').textContent=missing.length?'Следующее улучшение: '+missing[0].label.toLowerCase()+' (+'+missing[0].points+' баллов).':'Проверьте формулировки и подтвердите карточку.';
  $('#briefScore').textContent=confirmed?score+'/100 — подтверждено':potential+'/100 — после подтверждения';
}
Object.entries(formIds).forEach(([key,id])=>$('#'+id).addEventListener('input',()=>{
  readBaseFields(); draftChanged();
  if(state.briefOpen) { state.briefOpen=false; $('#briefPreview').classList.add('hidden'); }
}));
function requireBusiness(action) {
  if(!state.me) { openAuth('register', action); $('#authRole').value='Бизнес'; return false; }
  if(state.me.role!=='Бизнес') { showToast('Для этой задачи выберите роль «Бизнес» в профиле'); return false; }
  return true;
}
async function saveDraft(analyze=false) {
  const result=await api('tasks/save',{id:state.draft?.id,fields:state.fields,answers:state.answers,analyze,tags:state.me?.skills.join(', ') || ''});
  state.draft=result.task; state.questions=result.task.questions; state.dirty=false;
  syncDraftButtons(); return result.task;
}
function saveAction() { return perform($('#saveDraftBtn'),async()=>{readBaseFields(); if(!requireBusiness(saveAction))return; await saveDraft(); showToast('Черновик сохранён в «Мои задачи»'); await refresh();}); }
$('#saveDraftBtn').onclick=saveAction;
function analyzeAction() { return perform($('#analyzeBtn'),async()=>{
  readBaseFields();
  if(state.fields.problem.length<20) throw new Error('Опишите проблему хотя бы в одном предложении — от 20 символов');
  if(!requireBusiness(analyzeAction))return;
  await saveDraft(true); renderQuestions(); renderScore(); showToast('Нашла недостающие сведения. Ответьте минимум на три вопроса.');
  $('#clarificationPanel').scrollIntoView({behavior:'smooth',block:'start'});
}); }
$('#analyzeBtn').onclick=analyzeAction;
function renderQuestions() {
  $('#clarificationPanel').classList.toggle('hidden',!state.questions.length);
  $('#questionList').innerHTML=state.questions.map((q,index)=>'<div class="ai-question"><span>'+(index+1)+'</span><label class="field"><b>'+e(q.label)+'</b><textarea data-answer="'+e(q.key)+'" rows="3" placeholder="'+e(q.hint)+'">'+e(state.answers[q.key] || '')+'</textarea></label></div>').join('');
  syncDraftButtons();
}
$('#questionList').addEventListener('input',event=>{
  const key=event.target.dataset.answer; if(!key)return;
  state.answers[key]=event.target.value; state.fields[key]=event.target.value;
  syncBaseFields(); draftChanged();
  if(state.briefOpen) renderBrief();
});
function renderBrief() {
  state.briefOpen=true; $('#briefPreview').classList.remove('hidden');
  const keys=['title','problem','audience','category','data','resources','result','goal','deadline','limits','owner','contact','consultation','feedback',...['scope','validation','risks'].filter(key=>state.fields[key])];
  $('#briefFields').innerHTML=keys.map(key=>'<label class="field"><span>'+e(names[key])+'</span>'+(key==='data'?'<select data-brief="data"><option value="">Не указано</option><option value="yes">Да, готовы</option><option value="partial">Частично</option><option value="no">Нужно собрать</option></select>':'<textarea data-brief="'+key+'" rows="'+(['problem','resources','goal','limits'].includes(key)?3:2)+'" placeholder="Добавьте сведения или оставьте пустым">'+e(state.fields[key] || '')+'</textarea>')+'</label>').join('');
  $('[data-brief="data"]').value=state.fields.data || '';
  renderScore(); syncDraftButtons();
}
$('#buildBriefBtn').onclick=()=>{readBaseFields();renderBrief();$('#briefPreview').scrollIntoView({behavior:'smooth',block:'start'});};
$('#briefFields').addEventListener('input',event=>{
  const key=event.target.dataset.brief;if(!key)return;
  state.fields[key]=event.target.value.trim();
  if(state.questions.some(q=>q.key===key))state.answers[key]=event.target.value.trim();
  syncBaseFields(); draftChanged();
});
$('#confirmBriefBtn').onclick=()=>perform($('#confirmBriefBtn'),async()=>{
  if(!requireBusiness())return;
  await saveDraft(); const {task}=await api('tasks/confirm',{id:state.draft.id,revision:state.draft.revision});
  state.draft=task;state.dirty=false;renderScore();syncDraftButtons();showToast('Карточка подтверждена. Можно публиковать.');
});
$('#publishBtn').onclick=()=>perform($('#publishBtn'),async()=>{
  const {task}=await api('tasks/publish',{id:state.draft.id,revision:state.draft.revision});
  state.draft=task;await refresh();
  $('#catalogSearch').value='';$('#categoryFilter').value='all';renderCatalog();showView('catalog');
  showToast('Опубликовано: '+task.score+'/100. Позиция в каталоге определена рейтингом.');
  resetDraft();
});
function resetDraft() {state.draft=null;state.fields={};state.answers={};state.questions=[];state.dirty=false;state.briefOpen=false;syncBaseFields();renderQuestions();renderScore();$('#briefPreview').classList.add('hidden');}
$('#newDraftBtn').onclick=()=>perform($('#newDraftBtn'),async()=>{
  if(state.dirty && state.me?.role==='Бизнес') {await saveDraft();showToast('Предыдущий черновик сохранён');}
  else if(state.dirty && !state.me) {showToast('Сначала сохраните текущий черновик');return;}
  resetDraft();
});
function editDraft(taskId) {
  const task=state.tasks.find(t=>t.id===taskId); if(!task)return;
  state.draft=structuredClone(task);state.fields={...task.fields};state.answers={...task.answers};state.questions=task.questions;state.dirty=false;
  syncBaseFields();renderQuestions();renderScore();$('#briefPreview').classList.add('hidden');state.briefOpen=false;showView('create');
}
function renderCatalog() {
  const query=$('#catalogSearch').value.trim().toLowerCase(),category=$('#categoryFilter').value;
  const published=state.tasks.filter(t=>t.status==='published');
  const tasks=published.filter(t=>(category==='all'||t.fields.category===category) && (JSON.stringify(t.fields)+' '+t.tags.join(' ')).toLowerCase().includes(query)).sort((a,b)=>b.score-a.score||a.createdAt.localeCompare(b.createdAt));
  $('#homeTasks').textContent=published.length;$('#taskCount').textContent=tasks.length;$('#emptyState').classList.toggle('hidden',tasks.length>0);
  $('#taskGrid').innerHTML=tasks.map(t=>'<article class="task-card"><div class="task-top"><span class="category education">'+e(t.fields.category || 'Другое')+'</span><span class="match">'+(t.example?'Учебный пример':t.decision!==null?'Команды выбраны':'Открыта')+'</span></div><h3>'+e(t.fields.title)+'</h3><p>'+e(t.fields.problem)+'</p><div class="task-tags">'+t.tags.map(tag=>'<span>'+e(tag)+'</span>').join('')+'</div><div class="task-info"><span>◷ '+e(t.fields.deadline || 'Срок уточняется')+'</span><span>'+t.score+'/100</span></div><button class="card-button" data-open-task="'+t.id+'">Открыть карточку →</button></article>').join('');
}
$('#catalogSearch').oninput=renderCatalog;$('#categoryFilter').onchange=renderCatalog;
function openTask(taskId, edit=false) {
  const task=state.tasks.find(t=>t.id===taskId);if(!task)return;
  state.activeTask=task;$('#modalTaskTitle').textContent=task.fields.title;
  $('#taskDetails').innerHTML='<p class="muted">'+e(task.ownerName)+' · '+task.score+'/100 полноты</p>'+Object.entries(task.fields).filter(([key,value])=>value&&key!=='title').map(([key,value])=>'<div class="detail-row"><b>'+e(names[key] || key)+'</b><p>'+e(key==='data'?({yes:'Данные готовы',partial:'Есть частично',no:'Данные нужно собрать'}[value] || value):value)+'</p></div>').join('');
  const existing=state.proposals.find(p=>p.taskId===taskId && p.userId===state.me?.id);
  $('#proposalText').value=edit?existing?.text || '':'';
  $('#proposalTimeline').value=edit?existing?.timeline || '':'';
  let notice='';
  if(task.example)notice='Учебный пример карточки. Чтобы пройти весь путь, бизнес публикует собственную задачу, а команда отправляет на неё предложение.';
  else if(task.ownerId===state.me?.id)notice='Это ваша задача. Предложения команд появятся в разделе «Отклики → Мои задачи».';
  else if(task.decision!==null)notice='Бизнес завершил выбор команд по этой задаче.';
  else if(state.me?.role==='Бизнес')notice='Отклики отправляют специалисты и команды. Роль можно изменить в профиле.';
  else if(existing && existing.status!=='withdrawn' && !edit)notice='Ваш отклик уже отправлен. Его можно изменить в разделе «Мои отклики».';
  $('#proposalNotice').textContent=notice;$('#proposalNotice').classList.toggle('hidden',!notice);
  $('#proposalForm').classList.toggle('hidden',Boolean(notice));
  $('#sendProposal').textContent=!state.me?'Войти и отправить отклик':edit?'Сохранить предложение':'Отправить отклик';
  showModal($('#applyModal'));
}
$('#sendProposal').onclick=()=>perform($('#sendProposal'),async()=>{
  if(!state.me) {hideModal($('#applyModal'));openAuth('register',()=>openTask(state.activeTask.id));return;}
  await api('proposals/save',{taskId:state.activeTask.id,text:$('#proposalText').value,timeline:$('#proposalTimeline').value});
  hideModal($('#applyModal'));await refresh();showView('responses');switchResponsePanel('sent');showToast('Предложение отправлено бизнесу');
});
function switchResponsePanel(name) {
  $$('.response-tab').forEach(b=>{b.classList.toggle('active',b.dataset.responsePanel===name);b.setAttribute('aria-pressed',String(b.dataset.responsePanel===name));});
  $$('.response-panel').forEach(p=>p.classList.toggle('active',p.dataset.responseContent===name));
}
$$('.response-tab').forEach(b=>b.onclick=()=>switchResponsePanel(b.dataset.responsePanel));
$('#refreshResponses').onclick=()=>perform($('#refreshResponses'),async()=>{await refresh();showToast('Данные обновлены');});
const empty = message => '<div class="empty-state"><h3>'+e(message)+'</h3><p>Новые действия появятся здесь после публикации задачи или отправки предложения.</p></div>';
function progressHTML(p, business) {
  const completed=state.milestones.filter(m=>m.proposalId===p.id && m.status==='approved').reduce((sum,m)=>sum+m.points,0);
  return '<div class="progress-work"><h4>Результаты '+e(p.teamName)+' · '+completed+'/100 баллов</h4>'+stages.map((stage,index)=>{
    const m=state.milestones.find(item=>item.proposalId===p.id && item.stage===stage.key);
    const previousReady=stages.slice(0,index).every(s=>state.milestones.some(item=>item.proposalId===p.id && item.stage===s.key && item.status==='approved'));
    let controls='';
    if(m?.status==='approved')controls='<span class="ready-pill">Принято · +'+m.points+' баллов</span>';
    else if(m?.status==='submitted')controls=business?'<label class="field"><span>Комментарий для доработки</span><textarea data-feedback="'+m.id+'" placeholder="Что нужно исправить?"></textarea></label><button class="primary" data-review="'+m.id+'" data-action="approve">Принять этап · +'+m.points+'</button> <button class="secondary" data-review="'+m.id+'" data-action="revision">На доработку</button>':'<span class="application-status review">Ожидает проверки бизнеса · баллы ещё не начислены</span>';
    else if(!business && previousReady)controls='<label class="field"><span>Что сделано и где проверить результат?</span><textarea data-evidence="'+p.id+'-'+stage.key+'" placeholder="Опишите выполненную работу, приложите ссылку на репозиторий, демонстрацию или результаты теста...">'+e(m?.evidence || '')+'</textarea></label><button class="primary" data-submit-stage="'+stage.key+'" data-proposal="'+p.id+'">Отправить на проверку</button>';
    else controls='<p class="muted">'+(business?'Команда пока не передала результат.':'Сначала дождитесь принятия предыдущего этапа.')+'</p>';
    return '<section class="stage-card"><h4>'+e(stage.title)+' <span>'+stage.points+' баллов</span></h4>'+(m?'<p class="evidence">'+e(m.evidence)+'</p>':'')+(m?.feedback?'<p class="notice">Комментарий бизнеса: '+e(m.feedback)+'</p>':'')+controls+'</section>';
  }).join('')+'</div>';
}
function renderResponses() {
  const sent=state.proposals.filter(p=>p.userId===state.me?.id);
  $('#sentCount').textContent=sent.filter(p=>p.status!=='withdrawn').length;$('.nav-count').textContent=state.proposals.filter(p=>p.status==='review').length;
  $('#sentApplications').innerHTML=sent.length?sent.map(p=>{
    const task=state.tasks.find(t=>t.id===p.taskId);
    return '<article class="application-card"><div><span class="application-status '+(p.status==='accepted'?'accepted':p.status==='review'?'review':'withdrawn')+'">'+statuses[p.status]+'</span><h3>'+e(task?.fields.title || 'Задача')+'</h3><p>'+e(p.text)+'</p><p class="muted">'+e(p.timeline || '')+' · '+date(p.createdAt)+'</p></div><div class="application-actions"><button class="secondary" data-open-task="'+p.taskId+'">Карточка задачи</button>'+(p.status==='review'?'<button class="secondary" data-edit-proposal="'+p.taskId+'">Изменить</button><button class="withdraw-application" data-withdraw="'+p.id+'">Отозвать</button>':'')+'</div>'+(p.status==='accepted'?progressHTML(p,false):'')+'</article>';
  }).join(''):empty(state.me?'Вы ещё не отправляли предложений':'Войдите, чтобы увидеть свои отклики');
  const owned=state.tasks.filter(t=>t.ownerId===state.me?.id);
  $('#receivedCount').textContent=owned.length;
  if(!owned.some(t=>t.id===state.ownedTask))state.ownedTask=owned[0]?.id || '';
  $('#ownedTaskSelect').innerHTML=owned.map(t=>'<option value="'+t.id+'">'+e(t.fields.title || 'Без названия')+(t.status==='published'?'':' · черновик')+'</option>').join('');
  $('#ownedTaskSelect').value=state.ownedTask;
  renderReceived();
}
$('#ownedTaskSelect').onchange=()=>{state.ownedTask=$('#ownedTaskSelect').value;state.selections.clear();renderReceived();};
function renderReceived() {
  const task=state.tasks.find(t=>t.id===state.ownedTask);
  if(!task){$('#receivedApplications').innerHTML=empty(state.me?'У вас пока нет задач':'Войдите в профиль бизнеса');return;}
  if(task.status!=='published'){$('#receivedApplications').innerHTML='<div class="empty-state"><h3>Черновик · '+task.score+'/100</h3><p>Заполните карточку, подтвердите её и опубликуйте.</p><button class="primary" data-edit-draft="'+task.id+'">Продолжить черновик</button></div>';return;}
  const proposals=state.proposals.filter(p=>p.taskId===task.id && p.status!=='withdrawn');
  const open=task.decision===null;
  const selectable=proposals.filter(p=>p.status==='review').map(p=>p.id);
  state.selections=new Set([...state.selections].filter(id=>selectable.includes(id)));
  $('#receivedApplications').innerHTML='<div class="project-strip"><div><h3>'+e(task.fields.title)+'</h3><p>'+task.score+'/100 полноты</p></div><button class="secondary" data-open-task="'+task.id+'">Карточка</button></div>'+
    (open?'<div class="compare-toolbar"><div><b>Решение за вами</b><span>Выберите одну, несколько или ни одной команды.</span></div><strong id="selectedTeamsCount">'+state.selections.size+' выбрано</strong><button id="confirmTeamsBtn" class="primary" '+(!state.selections.size?'disabled':'')+'>Подтвердить выбор</button><button id="chooseNoneBtn" class="secondary">Никого не выбирать</button></div>':'<div class="notice">Решение сохранено: '+(task.decision.selected.length?'выбрано команд — '+task.decision.selected.length:'ни одна команда не выбрана')+'. Статусы видны участникам в их кабинетах.</div>')+
    (proposals.length?proposals.map(p=>'<article class="team-card '+(state.selections.has(p.id)?'selected':'')+'"><div class="team-main"><div class="team-avatar violet">'+e(p.teamName.charAt(0))+'</div><div><h3>'+e(p.teamName)+'</h3><p>'+statuses[p.status]+'</p></div></div><p class="proposal">'+e(p.text)+'</p><p>Срок и условия: '+e(p.timeline || 'Не указаны')+'</p><div class="team-skills">'+p.skills.map(s=>'<span>'+e(s)+'</span>').join('')+'</div>'+(open&&p.status==='review'?'<button class="secondary select-team" data-select="'+p.id+'" aria-pressed="'+state.selections.has(p.id)+'">'+(state.selections.has(p.id)?'Убрать из выбора':'Выбрать команду')+'</button>':'')+(p.status==='accepted'?progressHTML(p,true):'')+'</article>').join(''):empty('Предложений пока нет'));
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.openTask)openTask(button.dataset.openTask);
  if(button.dataset.editDraft)editDraft(button.dataset.editDraft);
  if(button.dataset.editProposal)openTask(button.dataset.editProposal,true);
  if(button.dataset.withdraw)perform(button,async()=>{await api('proposals/withdraw',{id:button.dataset.withdraw});await refresh();showToast('Отклик отозван');});
  if(button.dataset.select){const id=button.dataset.select;state.selections.has(id)?state.selections.delete(id):state.selections.add(id);renderReceived();}
  if(button.id==='confirmTeamsBtn'||button.id==='chooseNoneBtn')perform(button,async()=>{
    await api('tasks/decision',{id:state.ownedTask,selected:button.id==='chooseNoneBtn'?[]:[...state.selections]});
    state.selections.clear();await refresh();showToast('Решение сохранено. Команды видят новый статус.');
  });
  if(button.dataset.submitStage)perform(button,async()=>{
    const evidence=$('[data-evidence="'+button.dataset.proposal+'-'+button.dataset.submitStage+'"]').value;
    await api('milestones/submit',{proposalId:button.dataset.proposal,stage:button.dataset.submitStage,evidence});
    await refresh();showToast('Этап отправлен на проверку. Баллы начислятся после принятия.');
  });
  if(button.dataset.review)perform(button,async()=>{
    await api('milestones/review',{id:button.dataset.review,action:button.dataset.action,feedback:$('[data-feedback="'+button.dataset.review+'"]').value});
    await refresh();showToast(button.dataset.action==='approve'?'Этап принят. Баллы начислены команде.':'Результат возвращён на доработку');
  });
});
function renderProfile() {
  const me=state.me,initial=me?.name.charAt(0).toUpperCase() || '?';
  $('#profileInitial').textContent=initial;$('#profileAvatar').textContent=initial;
  $('#profileLabel').textContent=me?.name || 'Войти';$('#profileName').textContent=me?.name || 'Гость';
  $('#profileContact').textContent=me?.contact || 'Создайте профиль, чтобы участвовать';
  $('#profileRole').textContent=me?.role || '';
  $('#profileSkills').innerHTML=me?.skills.length?me.skills.map(s=>'<span>'+e(s)+'</span>').join(''):'<i>Навыки пока не указаны</i>';
  $('#profileApplications').textContent=state.proposals.filter(p=>p.userId===me?.id && p.status!=='withdrawn').length;
  $('#profileProjects').textContent=state.proposals.filter(p=>p.userId===me?.id && p.status==='accepted').length;
  $('#profilePoints').textContent=me?.points || 0;$('#logoutBtn').classList.toggle('hidden',!me);
}
let focusBeforeModal=null;
function showModal(modal) {focusBeforeModal=document.activeElement;closeChat();modal.classList.remove('hidden');$('input,textarea,button',modal)?.focus();}
function hideModal(modal) {modal.classList.add('hidden');focusBeforeModal?.focus();}
$$('.modal').forEach(modal=>modal.addEventListener('click',event=>{if(event.target===modal)hideModal(modal);}));
$('.modal-close').onclick=()=>hideModal($('#applyModal'));
$('.auth-close').onclick=()=>{state.afterAuth=null;hideModal($('#authModal'));};
$('#profileButton').onclick=()=>state.me?showView('profile'):openAuth('register');
$('#editProfileBtn').onclick=()=>openAuth(state.me?'edit':'register');
function openAuth(mode='register',after=null) {
  state.authMode=mode;state.afterAuth=after;
  $('#authForm').reset();$('#authError').textContent='';
  state.authMethod=state.me?.method || 'email';setAuthMethod(state.authMethod);
  if(mode==='edit'){$('#authName').value=state.me.name;$('#authRole').value=state.me.role;$('#authSkills').value=state.me.skills.join(', ');}
  renderAuth();showModal($('#authModal'));
}
function renderAuth() {
  const login=state.authMode==='login',edit=state.authMode==='edit';
  $('#authTitle').textContent=edit?'Изменить профиль':login?'С возвращением':'Создать профиль';
  $('.auth-submit').textContent=edit?'Сохранить':login?'Войти':'Зарегистрироваться';
  $('#authModes').classList.toggle('hidden',edit);$('#contactMethods').classList.toggle('hidden',edit);
  ['nameField','roleField','skillsField'].forEach(id=>$('#'+id).classList.toggle('hidden',login));
  ['contactField','passwordField','authNote'].forEach(id=>$('#'+id).classList.toggle('hidden',edit));
  $('#authName').required=!login;$('#authContact').required=!edit;$('#authPassword').required=!edit;
  $('#authPassword').minLength=login?1:8;$('#authPassword').autocomplete=login?'current-password':'new-password';
  $$('[data-auth-mode]').forEach(b=>b.classList.toggle('active',b.dataset.authMode===state.authMode));
}
$$('[data-auth-mode]').forEach(b=>b.onclick=()=>{state.authMode=b.dataset.authMode;$('#authError').textContent='';renderAuth();});
function setAuthMethod(method) {
  state.authMethod=method;$$('.auth-method').forEach(b=>b.classList.toggle('active',b.dataset.method===method));
  $('#contactLabel').textContent=method==='phone'?'Номер телефона':'Электронная почта';
  $('#authContact').type=method==='phone'?'tel':'email';$('#authContact').placeholder=method==='phone'?'+7 700 000 00 00':'name@example.com';
}
$$('.auth-method').forEach(b=>b.onclick=()=>setAuthMethod(b.dataset.method));
$('#authForm').onsubmit=async event=>{
  event.preventDefault();const button=$('.auth-submit');button.disabled=true;$('#authError').textContent='';
  try {
    const route=state.authMode==='edit'?'profile':state.authMode;
    await api(route,{name:$('#authName').value,contact:$('#authContact').value,password:$('#authPassword').value,method:state.authMethod,role:$('#authRole').value,skills:$('#authSkills').value.split(',').map(s=>s.trim()).filter(Boolean)});
    $('#authPassword').value='';hideModal($('#authModal'));await refresh();
    const action=state.afterAuth;state.afterAuth=null;
    if(action)await action();else showView('profile');
    showToast('Профиль готов');
  }catch(error){$('#authError').textContent=error.message;}finally{button.disabled=false;}
};
$('#logoutBtn').onclick=()=>perform($('#logoutBtn'),async()=>{
  if(state.dirty && state.me?.role==='Бизнес')await saveDraft();
  await api('logout',{});resetDraft();state.selections.clear();await refresh();showView('home');showToast('Вы вышли из аккаунта');
});
function addMessage(text) {
  const div=document.createElement('div');div.className='message bot';div.textContent=text;$('#chatMessages').append(div);$('#chatMessages').scrollTop=$('#chatMessages').scrollHeight;return div;
}
function openChat() {$('#aiChat').hidden=false;$('#aiChat').classList.add('open');$('#chatInput').focus();}
function closeChat() {$('#aiChat').hidden=true;$('#aiChat').classList.remove('open');}
$('#aiFab').onclick=openChat;$('#closeChat').onclick=closeChat;
function sendChat(query) {
  const clean=query.trim();if(!clean)return;addMessage(clean).className='message user';
  const lower=clean.toLowerCase();
  if(/заполн|рейтинг|не хватает|провер|уточн/.test(lower)) {
    const missing=readiness(state.fields).rows.filter(r=>!r.complete);
    addMessage(missing.length?'Чтобы повысить полноту, добавьте: '+missing.map(r=>r.label+' (+'+r.points+')').join('; ')+'.':'Все критерии заполнены. Проверьте карточку, подтвердите и опубликуйте её.');
    return;
  }
  if(/балл|этап|прогресс/.test(lower)) {addMessage('Выбранная команда отправляет описание выполненного этапа и доказательство результата. Бизнес принимает работу или возвращает на доработку. Только принятое выполнение приносит 20, 30 или 50 баллов; повторное начисление исключено.');return;}
  if(/отклик/.test(lower) && !/най|подбер/.test(lower)) {addMessage('Откройте проект в каталоге и отправьте предложение с планом и сроком. Статус появится в «Мои отклики». Бизнес сравнит предложения и примет решение.');return;}
  if(/команд/.test(lower)&&/сравн|выб/.test(lower)){addMessage('В «Мои задачи» сравните план, навыки и срок каждой команды. Выберите одну или несколько, затем подтвердите выбор. Если предложения не подходят, доступно решение «Никого не выбирать».');return;}
  if(/най|подбер|подбор|работ|проект|навык|специалист|дизайн|python|\bit\b/i.test(lower)) {
    const useProfile=/моим|мои|профил/.test(lower);
    if(useProfile&&!state.me?.skills.length){addMessage('Добавьте навыки в профиль или перечислите их здесь — например, Python, аналитика, дизайн.');return;}
    const results=recommend(state.tasks,clean,useProfile?state.me.skills:[]);
    if(!results.length){addMessage('По этим навыкам совпадений пока нет. Попробуйте другую специальность или посмотрите все задачи в каталоге.');return;}
    addMessage('Подобрала проекты из каталога. '+(results.every(r=>r.task.example)?'Пока это учебные примеры. Для реальных откликов бизнес должен опубликовать задачу.':'Откройте карточку, чтобы проверить условия.'));
    const box=addMessage('');box.classList.add('recommendations');
    box.innerHTML=results.map(({task,matches})=>'<div class="recommendation-item"><div><strong>'+e(task.fields.title)+'</strong><small>'+(matches.length?'Подходят навыки: '+e(matches.join(', ')):'Полнота описания: '+task.score+'/100')+'</small></div><button data-open-task="'+task.id+'">Открыть</button></div>').join('');
    $('#chatMessages').scrollTop=$('#chatMessages').scrollHeight;return;
  }
  addMessage('Я умею подбирать проекты по навыкам, находить недостающие сведения в карточке и объяснять отклики и этапы. Напишите, например: «найди проект для аналитика» или «что ещё заполнить?».');
}
$('#chatForm').onsubmit=event=>{event.preventDefault();sendChat($('#chatInput').value);$('#chatInput').value='';};
$$('.quick-prompts button').forEach(b=>b.onclick=()=>sendChat(b.textContent));
$('#findForMeBtn').onclick=()=>{openChat();sendChat('Подбери по моим навыкам');};
document.addEventListener('keydown',event=>{
  const modal=$$('.modal').find(m=>!m.classList.contains('hidden'));
  if(event.key==='Escape'){closeChat();if(modal)hideModal(modal);}
  if(event.key==='Tab'&&modal){
    const focusable=$$('button,input,textarea,select',modal).filter(el=>!el.disabled&&el.getClientRects().length);
    if(event.shiftKey&&document.activeElement===focusable[0]){event.preventDefault();focusable.at(-1)?.focus();}
    else if(!event.shiftKey&&document.activeElement===focusable.at(-1)){event.preventDefault();focusable[0]?.focus();}
  }
});
renderScore();refresh().catch(()=>{});
