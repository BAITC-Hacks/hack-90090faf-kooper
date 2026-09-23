import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readiness, questionsFor, recommend } from '../core.mjs';

const temp=mkdtempSync(join(tmpdir(),'sana-test-'));
let processHandle, base;
async function start() {
  processHandle=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',SANA_DB:join(temp,'test.sqlite')},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{
    let output='';
    const timer=setTimeout(()=>reject(new Error('Server start timeout: '+output)),10000);
    processHandle.stdout.on('data',data=>{output+=data;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
    processHandle.stderr.on('data',data=>{output+=data;});
    processHandle.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exit '+code+' '+output));});
  });
}
async function stop() { if(!processHandle || processHandle.exitCode!==null)return; await new Promise(resolve=>{processHandle.once('exit',resolve);processHandle.kill();}); }
before(start);
after(stop);
function client() {
  let cookie='';
  return async (path,body,expected=200)=>{
    const res=await fetch(base+'/api/'+path,{headers:{Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
    const setCookie=res.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
    const payload=await res.json();
    assert.equal(res.status,expected,JSON.stringify(payload));
    return payload;
  };
}
test('readiness has no click bonuses; questions target missing information; skills alter recommendations',()=>{
  assert.equal(readiness({}).score,0);
  const complete={title:'Valid title',problem:'A problem that is longer than twenty characters',audience:'Users',category:'IT',data:'no',result:'Working prototype',deadline:'2 weeks',goal:'Reduce delay by 30 percent',limits:'No personal information',resources:'Data is available after NDA',owner:'Support lead',contact:'support@example.test',consultation:'Weekly video call for 30 minutes',feedback:'Review within two working days'};
  assert.equal(readiness(complete).score,0);
  assert.equal(readiness(complete).potential,100);
  assert.equal(readiness(complete,true).score,100);
  assert.equal(readiness({...complete,goal:''},true).score,85);
  assert.equal(readiness({...complete,contact:''},true).score,90);
  assert.equal(readiness({...complete,consultation:''},true).score,90);
  assert.equal(readiness({...complete,feedback:''},true).score,90);
  for (const [key,weight] of [['problem',20],['resources',20],['result',15],['goal',15],['audience',10]]) assert.equal(readiness({...complete,[key]:''},true).score,100-weight);
  assert.equal(readiness({...complete,limits:'',deadline:''},true).score,90);
  assert.equal(readiness({...complete,resources:'Неизвестно'},true).score,80);
  assert.equal(readiness({...complete,title:'',category:'',data:'',owner:''},true).score,100);
  const qs=questionsFor({...complete,goal:'',limits:'',deadline:''});
  assert.ok(qs.length>=3);assert.ok(qs.some(q=>q.key==='goal'));assert.ok(qs.some(q=>q.key==='limits'));
  assert.ok(questionsFor(complete).length>=3);
  const tasks=[{id:'data',status:'published',fields:{title:'Demand',problem:'Planning'},tags:['Data','ML'],score:70},{id:'design',status:'published',fields:{title:'Interface',problem:'Website'},tags:['UX/UI','Web'],score:60}];
  assert.equal(recommend(tasks,'Я дизайнер')[0].task.id,'design');
  assert.equal(recommend(tasks,'Найди проект аналитику')[0].task.id,'data');
});

test('all eight stages across separate accounts; persistence, ownership and duplicate prevention',async()=>{
  const biz=client(), teamA=client(), teamB=client(), stranger=client();
  await biz('register',{name:'QA Business',contact:'business@example.test',method:'email',password:'Test-pass-42',role:'Бизнес',skills:['Python']});
  const a=await teamA('register',{name:'QA Kooper',contact:'+77001112233',method:'phone',password:'Test-pass-42',role:'Команда',skills:['Python','RAG']});
  const b=await teamB('register',{name:'QA Design',contact:'design@example.test',method:'email',password:'Test-pass-42',role:'Команда',skills:['UX/UI']});
  const fields={title:'Поддержка студентов',problem:'Студенты ждут ответы на типовые вопросы и теряют время в очереди.',category:'Образование',audience:'Студенты',data:'partial',result:'Прототип сайта',deadline:'Через месяц'};
  let {task}=await biz('tasks/save',{fields,analyze:true});
  assert.equal(task.status,'draft');assert.ok(task.questions.length>=3);
  await biz('tasks/publish',{id:task.id,revision:task.revision},400);
  await biz('tasks/confirm',{id:task.id,revision:task.revision},400);
  const answers=Object.fromEntries(task.questions.map(q=>[q.key,'Подробный ответ с условиями и проверяемыми критериями результата.']));
  ({task}=await biz('tasks/save',{id:task.id,fields:{...fields,...answers},answers}));
  assert.equal(task.score,0);
  await stranger('tasks/confirm',{id:task.id,revision:task.revision},401);
  await teamA('tasks/confirm',{id:task.id,revision:task.revision},403);
  await biz('tasks/confirm',{id:task.id,revision:task.revision});
  ({task}=await biz('tasks/save',{id:task.id,fields:{...task.fields,title:'Изменённая задача'},answers}));
  await biz('tasks/publish',{id:task.id,revision:task.revision},400);
  await biz('tasks/confirm',{id:task.id,revision:task.revision-1},409);
  ({task}=await biz('tasks/confirm',{id:task.id,revision:task.revision}));
  assert.equal(task.score,readiness(task.fields,true).score);
  await biz('tasks/publish',{id:task.id,revision:task.revision});
  await biz('tasks/publish',{id:task.id,revision:task.revision});
  const catalog=(await stranger('state')).tasks;
  assert.equal(catalog.filter(t=>t.id===task.id).length,1);
  assert.equal((await biz('state')).tasks.find(t=>t.id===task.id).status,'published');
  const suggestion=await stranger('assistant',{query:'Найди Изменённая задача'});
  assert.ok(suggestion.recommendations.some(t=>t.id===task.id),'new publication should be visible to the assistant');
  const help=await stranger('assistant',{query:'Где моя задача?'});
  assert.ok(help.actions.some(a=>a.kind==='owned'));
  await stranger('assistant',{query:''},400);
  for(let i=1;i<catalog.length;i++)assert.ok(catalog[i-1].score>=catalog[i].score);
  const {proposal:pa}=await teamA('proposals/save',{taskId:task.id,text:'Предлагаем прототип с поиском по базе FAQ и тестированием.',timeline:'2 недели'});
  const {proposal:pb}=await teamB('proposals/save',{taskId:task.id,text:'Подготовим интерфейс и проверим сценарии со студентами.',timeline:'3 недели'});
  const {proposal:edited}=await teamA('proposals/save',{taskId:task.id,text:'Обновлённый план: рабочий прототип за неделю с проверкой качества.',timeline:'1 неделя'});
  assert.equal(pa.id,edited.id);
  assert.equal((await biz('state')).proposals.length,2);
  assert.equal((await teamA('state')).proposals.length,1);
  await teamA('tasks/decision',{id:task.id,selected:[pa.id]},403);
  await biz('tasks/decision',{id:task.id,selected:['missing']},400);
  await biz('tasks/decision',{id:task.id,selected:[pa.id,pb.id]});
  assert.equal((await teamA('state')).proposals[0].status,'accepted');
  assert.equal((await teamB('state')).proposals[0].status,'accepted');
  await teamB('milestones/submit',{proposalId:pa.id,stage:'plan',evidence:'Чужой результат, который нельзя отправлять за другую команду.'},403);
  await teamA('milestones/submit',{proposalId:pa.id,stage:'result',evidence:'Нельзя отправить финальный результат до прохождения предыдущих этапов.'},400);
  const {milestone:plan}=await teamA('milestones/submit',{proposalId:pa.id,stage:'plan',evidence:'План согласован на встрече; артефакт https://example.test/plan'});
  assert.equal((await teamA('state')).me.points,0);
  await teamA('milestones/review',{id:plan.id,action:'approve'},403);
  await biz('milestones/review',{id:plan.id,action:'revision',feedback:'Добавить критерии оценки результата'});
  const {milestone:revised}=await teamA('milestones/submit',{proposalId:pa.id,stage:'plan',evidence:'План дополнен измеримыми критериями: не более пяти минут на ответ.'});
  assert.equal(revised.id,plan.id);
  await biz('milestones/review',{id:plan.id,action:'approve'});
  await biz('milestones/review',{id:plan.id,action:'approve'},409);
  assert.equal((await teamA('state')).me.points,20);
  assert.equal((await teamB('state')).me.points,0);
  const {milestone:proto}=await teamA('milestones/submit',{proposalId:pa.id,stage:'prototype',evidence:'Рабочий прототип показан, репозиторий https://example.test/repo'});
  await biz('milestones/review',{id:proto.id,action:'approve'});
  const {milestone:result}=await teamA('milestones/submit',{proposalId:pa.id,stage:'result',evidence:'Проверили 100 вопросов: 92 корректных ответа; отчёт https://example.test/report'});
  await biz('milestones/review',{id:result.id,action:'approve'});
  assert.equal((await teamA('state')).me.points,100);
  // A separate project can select nobody; withdrawn applicants cannot be selected.
  let {task:second}=await biz('tasks/save',{fields,analyze:true});
  const secondAnswers=Object.fromEntries(second.questions.map(q=>[q.key,'Уточнённые условия и критерии результата для второго проекта.']));
  ({task:second}=await biz('tasks/save',{id:second.id,fields:{...fields,...secondAnswers},answers:secondAnswers}));
  await biz('tasks/confirm',{id:second.id,revision:second.revision});
  await biz('tasks/publish',{id:second.id,revision:second.revision});
  const {proposal:withdrawn}=await teamA('proposals/save',{taskId:second.id,text:'Отправляем предложение для второй задачи и проверяем отзыв.'});
  await teamA('proposals/withdraw',{id:withdrawn.id});
  await biz('tasks/decision',{id:second.id,selected:[withdrawn.id]},400);
  await teamB('proposals/save',{taskId:second.id,text:'Предложение команды дизайна для второй опубликованной задачи.'});
  await biz('tasks/decision',{id:second.id,selected:[]});
  assert.equal((await teamB('state')).proposals.find(p=>p.taskId===second.id).status,'rejected');
  // Exactly one team is a valid business decision as well.
  let {task:third}=await biz('tasks/save',{fields,analyze:true});
  const thirdAnswers=Object.fromEntries(third.questions.map(q=>[q.key,'Подробные условия для третьего проекта и проверяемый результат.']));
  ({task:third}=await biz('tasks/save',{id:third.id,fields:{...fields,...thirdAnswers},answers:thirdAnswers}));
  await biz('tasks/confirm',{id:third.id,revision:third.revision});
  await biz('tasks/publish',{id:third.id,revision:third.revision});
  const {proposal:single}=await teamB('proposals/save',{taskId:third.id,text:'Предложение единственной команды по третьей задаче.'});
  await biz('tasks/decision',{id:third.id,selected:[single.id]});
  assert.equal((await biz('state')).tasks.find(t=>t.id===third.id).decision.selected.length,1);
  // Restart the server and verify users, sessions, catalogue and earned points survive.
  await stop();await start();
  assert.equal((await teamA('state')).me.points,100);
  assert.equal((await biz('state')).tasks.find(t=>t.id===task.id).decision.selected.length,2);
  await teamA('logout',{});
  assert.equal((await teamA('state')).me,null);
  await teamA('login',{contact:'+7 700 111 22 33',method:'phone',password:'wrong'},401);
  const login=await teamA('login',{contact:'+7 700 111 22 33',method:'phone',password:'Test-pass-42'});
  assert.equal(login.me.id,a.me.id);assert.equal(login.me.points,100);
  assert.notEqual(a.me.id,b.me.id);
  const privateFile=await fetch(base+'/data/sana.sqlite');assert.equal(privateFile.status,404);
});
