import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogTasks,recommend,readinessLevel} from '../core.mjs';
import {assistantReply} from '../assistant.mjs';
import {analyzeDraft,parseAIResponse} from '../ai.mjs';

const card=(id,title,tags,score=75,extra={})=>({id,fields:{title,problem:'Нужна помощь с проектом для пользователей',category:'IT'},tags,score,status:'published',decision:null,createdAt:'2026-09-23',...extra});
const tasks=[card('python','Учёт продаж магазина',['Python','Data']),card('web','Дизайн сайта',['UX/UI','JavaScript']),card('java','Сервис на Java',['Java']),card('low','Прототип Python',['Python'],20),card('closed','Архив Python',['Python'],100,{decision:{selected:[]}}),card('private','Черновик Python',['Python'],100,{status:'draft'})];

test('catalog searches words, aliases and Russian text without leaking drafts or JSON keys',()=>{
  assert.deepEqual(catalogTasks(tasks,{query:'МАГАЗИНА   учет'}).map(t=>t.id),['python']);
  assert.deepEqual(catalogTasks(tasks,{query:'найди мне работу на питоне'}).map(t=>t.id),['closed','python','low']);
  assert.deepEqual(catalogTasks(tasks,{query:'Java'}).map(t=>t.id),['java']);
  assert.deepEqual(catalogTasks(tasks,{query:'JavaScript'}).map(t=>t.id),['web']);
  assert.equal(catalogTasks(tasks,{query:'contact'}).length,0);
  assert.equal(catalogTasks(tasks,{query:'неттакогослова'}).length,0);
  assert.equal(catalogTasks(tasks,{category:'Ритейл'}).length,0);
  assert.deepEqual(catalogTasks(tasks,{query:'Python',activeOnly:true}).map(t=>t.id),['python','low']);
  assert.ok(catalogTasks(tasks,{query:'   '}).some(t=>t.id==='low'));
  for(const [score,key] of [[0,'draft'],[39,'draft'],[40,'working'],[69,'working'],[70,'ready'],[89,'ready'],[90,'priority'],[100,'priority']])assert.equal(readinessLevel(score).key,key);
});

test('assistant uses live tasks, admits no match and exposes useful actions without choosing teams',()=>{
  assert.deepEqual(recommend(tasks,'я знаю Java').map(r=>r.task.id),['java']);
  assert.equal(recommend(tasks,'найди работу Kubernetes').length,0);
  assert.ok(!recommend(tasks,'Python').some(r=>['low','closed','private'].includes(r.task.id)));
  const result=assistantReply({query:'найди мне работу я специалист IT',tasks});
  assert.ok(result.recommendations.length>0);assert.equal(result.mode,'local');
  assert.ok(result.recommendations.every(t=>!['private','low','closed'].includes(t.id)));
  assert.ok(assistantReply({query:'где моя задача?',tasks}).actions.some(a=>a.kind==='owned'));
  assert.ok(assistantReply({query:'Что ещё заполнить?',tasks}).text.includes('Сначала откройте'));
  assert.ok(assistantReply({query:'Подбери по моим навыкам',skills:['Java'],tasks}).recommendations.some(t=>t.id==='java'));
  assert.ok(assistantReply({query:'Подбери по моим навыкам',tasks}).actions.some(a=>a.kind==='profile'));
  assert.equal(assistantReply({query:'выбери команду за меня',tasks}).recommendations.length,0);
  const low=assistantReply({query:'Найди Python',tasks:[tasks[3]]});
  assert.equal(low.recommendations.length,0);assert.ok(low.text.includes('ниже 40'));assert.ok(low.actions.some(a=>a.kind==='search'));
});

test('AI analyzes only supplied fields and recovers from malformed structured replies',async()=>{
  const fields={problem:'Менеджеры отвечают студентам слишком долго',category:'Образование'};
  const snapshot=JSON.stringify(fields);
  const local=await analyzeDraft(fields);assert.ok(local.questions.length>=3);assert.equal(local.mode,'local');
  for(const raw of ['not json','{}','{"questions":[]}',JSON.stringify({questions:[{key:'secret',label:'Something invented',hint:''}]})]) {
    const result=await analyzeDraft(fields,async()=>raw);assert.equal(result.mode,'local-fallback');assert.ok(result.questions.length>=3);
  }
  assert.throws(()=>parseAIResponse({questions:[local.questions[0],local.questions[0],local.questions[0]]}));
  assert.equal(JSON.stringify(fields),snapshot);
});
