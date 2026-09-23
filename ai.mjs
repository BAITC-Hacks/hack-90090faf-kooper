import { questionsFor, readiness } from './core.mjs';

export const PROMPT = `Ты — помощник подготовки задач AI Sana. Проанализируй только переданный
черновик и список missingCriteria. Верни JSON без Markdown: {"questions":[...]}.
Сгенерируй 3–6 уместных вопросов о недостающих сведениях. У каждого вопроса:
key (ключ поля), label (вопрос), hint (пример ответа, явно начинающийся со слова
«Например», или инструкция). Не добавляй факты, сроки, контакты и ресурсы
от имени бизнеса. Не переписывай поля и не выбирай исполнителей.
Допустимые key: goal, audience, resources, limits, result, deadline, contact,
consultation, feedback, owner, scope, validation, risks.
Не используй персональные или чувствительные признаки участников.
Вопросы должны касаться проблемы, данных, результата, критериев приёмки,
ограничений и взаимодействия с бизнесом. Если всё заполнено, уточни границы
первой версии, проверку результата и риски. Решение о публикации принимает человек.`;

const allowed=new Set(['goal','audience','resources','limits','result','deadline','contact','consultation','feedback','owner','scope','validation','risks']);
export function parseAIResponse(raw) {
  let parsed;
  try {parsed=typeof raw==='string'?JSON.parse(raw):raw;} catch {throw new Error('Ответ AI не является JSON');}
  if(!parsed || !Array.isArray(parsed.questions)||parsed.questions.length<3||parsed.questions.length>6)throw new Error('AI должен вернуть от 3 до 6 вопросов');
  const seen=new Set();
  const questions=parsed.questions.map(q=>{
    if(!q||!allowed.has(q.key)||seen.has(q.key)||typeof q.label!=='string'||q.label.trim().length<10||q.label.length>500||typeof q.hint!=='string'||q.hint.length>500)throw new Error('Некорректный формат вопроса AI');
    seen.add(q.key);
    return {key:q.key,label:q.label.trim(),hint:q.hint.trim()};
  });
  return {questions};
}
export async function analyzeDraft(fields, generate) {
  const input={draft:fields,missingCriteria:readiness(fields).rows.filter(row=>!row.complete).map(({key,label,points})=>({key,label,points}))};
  if(generate) {
    try {return {...parseAIResponse(await generate({prompt:PROMPT,input})),mode:'external'};}
    catch {return {...parseAIResponse({questions:questionsFor(fields)}),mode:'local-fallback',notice:'Ответ AI не прошёл проверку. Использованы локальные уточняющие вопросы.'};}
  }
  return {...parseAIResponse({questions:questionsFor(fields)}),mode:'local',notice:'Локальный помощник: вопросы по недостающим сведениям.'};
}
