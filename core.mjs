export const criteria = [
  ['problem', 'Контекст и потребность', 20, 20],
  ['resources', 'Данные и материалы', 20, 10],
  ['result', 'Ожидаемый результат', 15, 10],
  ['goal', 'Критерии успеха', 15, 10],
  ['limits', 'Ограничения', 10, 10],
  ['audience', 'Пользователи', 10, 3],
  ['business', 'Связь с бизнесом', 10, 0]
];
const filled = (value, min) => {
  const s=String(value || '').trim();
  return s.length>=min && !/^(пока )?(не знаю|неизвестно|не указано|уточняется|нет( данных| материалов)?|пока нет|тест|test)[.! ]*$/i.test(s);
};
export function readiness(fields = {}, confirmed = false) {
  const rows = criteria.map(([key,label,points,min])=>{
    let complete=filled(fields[key],min);
    if(key==='limits')complete=complete || filled(fields.deadline,3);
    if(key==='business')complete=filled(fields.contact,5)&&filled(fields.consultation,10)&&filled(fields.feedback,10);
    return {key,label,points,complete,confirmed:complete&&confirmed};
  });
  const potential=rows.reduce((sum,row)=>sum+(row.complete?row.points:0),0);
  return {score:confirmed?potential:0,potential,rows};
}
export function readinessLevel(score) {
  if(score<40)return {key:'draft',label:'Черновик',hint:'Требует уточнения. Откликнуться можно.'};
  if(score<70)return {key:'working',label:'Рабочая',hint:'Достаточно сведений для первых предложений.'};
  if(score<90)return {key:'ready',label:'Готовая',hint:'Задача готова к работе и стоит выше в каталоге.'};
  return {key:'priority',label:'Приоритетная',hint:'Высокая готовность к работе со студентами.'};
}
export function questionsFor(fields = {}) {
  const text = `${fields.category || ''} ${fields.problem || ''}`.toLowerCase();
  const context = /студент|учеб|образован/.test(text) ? 'студентов' : /магазин|товар|продаж|ритейл/.test(text) ? 'покупателей и сотрудников' : /врач|пациент|медицин/.test(text) ? 'пациентов и сотрудников' : 'пользователей';
  const missing = readiness(fields).rows.filter(row => !row.complete).map(row => row.key);
  const bank = [
    { key: 'goal', label: `Какой измеримый результат покажет, что проблема ${context} решена?`, hint: 'Например: сократить время ожидания с 20 до 5 минут.' },
    { key: 'audience', label: 'Кто сталкивается с проблемой и как часто?', hint: 'Например: 200 студентов в день обращаются в поддержку.' },
    { key: 'resources', label: 'Какие материалы уже есть и как команда получит к ним доступ?', hint: 'Опишите файлы, примеры, данные или укажите, что их нужно собрать.' },
    { key: 'limits', label: `Какие ограничения нужно учесть при работе с данными ${context}?`, hint: 'Например: обезличить данные; использовать только открытые библиотеки.' },
    { key: 'result', label: 'Что именно команда должна передать в конце работы?', hint: 'Например: работающий сайт, инструкция и результаты проверки.' },
    { key: 'deadline', label: 'Когда нужен первый результат и сколько времени есть на проект?', hint: 'Например: прототип через 2 недели, финальная версия через месяц.' },
    { key: 'contact', criterion:'business', label: 'Как команда свяжется с ответственным представителем бизнеса?', hint: 'Укажите рабочую почту или другой контакт, который можно публиковать.' },
    { key: 'consultation', criterion:'business', label: 'Как будут проходить консультации с бизнесом?', hint: 'Например: видеовстреча на 30 минут каждый вторник.' },
    { key: 'feedback', criterion:'business', label: 'Как и когда бизнес даст обратную связь по результату?', hint: 'Например: проверка в течение двух рабочих дней и комментарий в карточке этапа.' }
  ];
  const selected = bank.filter(q => missing.includes(q.criterion || q.key) && !filled(fields[q.key],q.key==='contact'?5:10)).slice(0, 4);
  const extra = [
    { key: 'scope', label: 'Что обязательно должно войти в первую версию, а что можно отложить?', hint: 'Укажите 2–3 главные функции.' },
    { key: 'validation', label: 'На каком примере вы проверите готовое решение?', hint: 'Опишите конкретный тест и ожидаемый результат.' },
    { key: 'risks', label: 'Что может помешать работе и как это предусмотреть?', hint: 'Например: задержка доступа к данным, нужен резервный набор.' }
  ];
  for (const q of extra) if (selected.length < 3) selected.push(q);
  return selected;
}
export const stages = [
  { key: 'plan', title: 'План и критерии согласованы', points: 20 },
  { key: 'prototype', title: 'Рабочий прототип показан', points: 30 },
  { key: 'result', title: 'Результат проверен и принят', points: 50 }
];
export function validateBrief(task) {
  const f = task.fields || {};
  if (String(f.title || '').trim().length < 5 || String(f.problem || '').trim().length < 20) return 'Добавьте название (от 5 символов) и описание проблемы (от 20 символов).';
  if (!Array.isArray(task.questions) || task.questions.length < 3) return 'Сначала получите уточняющие вопросы.';
  if (task.questions.filter(q => String(task.answers?.[q.key] || '').trim().length >= 10).length < 3) return 'Ответьте минимум на три вопроса (от 10 символов на ответ).';
  return '';
}
export const normalizeSearch = value => String(value || '').normalize('NFKC').toLowerCase().replace(/ё/g,'е');
const words = value => normalizeSearch(value).match(/[\p{L}\p{N}+#]+/gu) || [];
// Groups describe work and technologies, never personal characteristics.
const groups = [
  ['python','питон'], ['javascript','js','джаваскрипт'], ['java','джава'], ['c++','cpp'], ['c#','csharp'],
  ['аналит','analytics','analysis','data','данн','ml','прогноз'],
  ['дизайн','design','designer','ux','ui','figma','интерфейс'],
  ['frontend','фронтенд','web','веб','сайт','react','html','css'],
  ['backend','бэкенд','api','сервер','sql'],
  ['ии','ai','rag','llm','нейросет','nlp','бот'],
  ['it','айти','разработ','программ','python','javascript','web','api','rag']
];
const stopWords = new Set(words('найди найти ищу мне нам для по и с со в на а или работу работы задача задачи задач проект проекты проектов подходящую подходящие подходящий есть я мы специалист специалиста умею знаю хочу нужен нужна нужно подбери подобрать покажи пожалуйста мой мои моим навыкам интересам профиль интересует'));
const prefixMatch = (word, token) => word===token || (/^[а-я]{4,}$/.test(token) && word.startsWith(token.replace(/(иями|ами|ого|ему|ыми|ий|ый|ая|ое|ые|ов|ам|ом|ах|ы|а|я|у|е|и)$/u,'')));
function alternatives(token) {
  const group = groups.find(items=>items.some(item=>prefixMatch(token,item)));
  return group || [token];
}
function contains(hay, token) { return alternatives(token).some(term=>hay.some(word=>prefixMatch(word,term))); }
export function queryTerms(query) { return [...new Set(words(query).filter(word=>!stopWords.has(word)))]; }
function taskWords(task) {
  const f=task.fields || {};
  return words([f.title,f.problem,f.audience,f.category,f.result,f.goal,f.resources,f.limits,...(task.tags || [])].join(' '));
}
export function matchesTask(task, query) { const hay=taskWords(task); return queryTerms(query).every(token=>contains(hay,token)); }
export function catalogTasks(tasks, {query='',category='all',activeOnly=false}={}) {
  return tasks.filter(t=>t.status==='published' && (!activeOnly || t.decision==null) && (category==='all'||t.fields.category===category) && matchesTask(t,query))
    .sort((a,b)=>b.score-a.score || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}
export function recommend(tasks, query, skills = []) {
  const terms=queryTerms([query,...skills].join(' '));
  return catalogTasks(tasks,{activeOnly:true}).filter(t=>t.score>=40).map(task=>{
    const hay=taskWords(task), matches=terms.filter(term=>contains(hay,term));
    return {task,matches,relevance:matches.length};
  }).filter(r=>!terms.length || r.relevance>0).sort((a,b)=>b.relevance-a.relevance||b.task.score-a.task.score).slice(0,3);
}
