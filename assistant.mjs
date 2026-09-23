import { readiness, recommend, catalogTasks, queryTerms, normalizeSearch } from './core.mjs';

export function assistantReply({query,fields={},tasks=[],skills=[],previousSearch=''}) {
  const clean=String(query || '').trim(), lower=normalizeSearch(clean);
  const action=(label,kind,value='')=>({label,kind,value});
  const reply=(text,extra={})=>({mode:'local',text,actions:[],recommendations:[],...extra});
  if(!clean)return reply('Напишите запрос: например, «найди проект на Python».');
  if(/где|не появ|не вид|пропал|активн/.test(lower)&&/задач|проект|публик/.test(lower))return reply('Сохранённый черновик находится в «Мои задачи». После подтверждения нажмите «Опубликовать в каталоге»: задача появится в активных заданиях и останется после обновления страницы. Если включены фильтры поиска, сбросьте их.',{actions:[action('Мои задачи','owned'),action('Активные задания','active')]});
  if(/созда|состав|сформулир|описание задачи/.test(lower)&&!/най|ищу/.test(lower))return reply('Опишите, что не работает сейчас. Я задам минимум три уточняющих вопроса. Ответы попадут в редактируемую карточку; подтверждение и публикация остаются за вами.',{actions:[action('Перейти к черновику','create'),...(String(fields.problem || '').length>=20?[action('Получить вопросы','clarify')]:[])]});
  if(/заполн|рейтинг|не хватает|провер.*карточ|уточн|улучш.*задач/.test(lower)) {
    const missing=readiness(fields).rows.filter(r=>!r.complete);
    if(!Object.values(fields).some(Boolean))return reply('Сначала откройте свой черновик в «Мои задачи» или начните новый. Тогда я проверю именно вашу карточку, а не пустую форму.',{actions:[action('Мои задачи','owned'),action('Создать задачу','create')]});
    return reply(missing.length?'В этой карточке ещё не хватает: '+missing.map(r=>r.label+' (+'+r.points+' баллов)').join('; ')+'. Баллы появятся после вашего подтверждения.':'Все семь критериев заполнены. Проверьте факты и подтвердите карточку. Я не публикую её автоматически.',{actions:[action('Перейти к карточке','create'),...(String(fields.problem || '').length>=20?[action('Уточнить детали','clarify')]:[])]});
  }
  if(/команд/.test(lower)&&/выб|сравн|назнач/.test(lower))return reply('Я не выбираю команду за бизнес. В «Мои задачи» сравните предложения, навыки и сроки. Можно выбрать одну, несколько или ни одной команды.',{actions:[action('Сравнить предложения','owned')]});
  if(/балл|этап|прогресс/.test(lower))return reply('Баллы команды и готовность задачи — разные вещи. Команда получает 20, 30 и 50 баллов за этапы только после проверки результата бизнесом.',{actions:[action('Отклики и этапы','responses')]});
  if(/отклик/.test(lower)&&!/най|подбер|ищу/.test(lower))return reply('Откройте задачу и отправьте своё предложение. Низкий рейтинг не запрещает отклик. Отправленные предложения и решение бизнеса видны в «Мои отклики».',{actions:[action('Открыть каталог','catalog'),action('Мои отклики','responses')]});
  const followup=/^(а )?(еще|другие|другие варианты|что еще)[?!. ]*$/.test(lower);
  const useProfile=/моим|мои навы|профил/.test(lower);
  const search=followup?previousSearch:clean;
  if(useProfile && !skills.length)return reply('В профиле ещё нет навыков. Добавьте их или напишите прямо здесь, например «я знаю Python и SQL».',{actions:[action('Заполнить профиль','profile')]});
  if(/най|подбер|подбор|работ|ваканс|проект|задач|навык|умею|знаю|специалист|дизайн|аналит|разработ|программ/.test(lower)||useProfile||followup||queryTerms(clean).some(t=>['python','sql','java','javascript','react','it','айти','figma','c++','c#'].includes(t))) {
    const recommendations=recommend(tasks,useProfile?'':search,useProfile?skills:[]);
    const catalogQuery=useProfile?skills[0] || '':queryTerms(search).join(' ');
    if(!recommendations.length) {
      const low=catalogTasks(tasks,{query:catalogQuery,activeOnly:true}).filter(t=>t.score<40);
      return reply(low.length?'Есть совпадения, но их готовность ниже 40 баллов. Я не включаю их в рекомендации: откройте поиск, изучите недостающие сведения и при желании откликнитесь.':'Подходящих открытых проектов пока не нашлось. Я не буду выдавать случайные задачи за совпадения. Можно посмотреть весь каталог или уточнить навыки.',{search,actions:[action('Посмотреть в поиске','search',catalogQuery),action('Весь каталог','catalog')]});
    }
    return reply('Подобраны открытые проекты по описанию и навыкам. Это проекты из каталога, не гарантированные вакансии. '+(recommendations.every(r=>r.task.example)?'Эти карточки помечены как учебные примеры.':''),{search,recommendations:recommendations.map(({task,matches})=>({id:task.id,title:task.fields.title,score:task.score,matches})),actions:[action('Все задачи по запросу','search',catalogQuery),action('Весь каталог','catalog')]});
  }
  return reply('Я работаю как локальный помощник: могу найти проект по навыкам, проверить заполнение карточки или показать ваши задачи. Попробуйте «я знаю Python», «что ещё заполнить?» или «где моя задача?».',{actions:[action('Открыть каталог','catalog'),action('Мои задачи','owned')]});
}
