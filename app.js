const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = { view: 'home', dataChoice: '', filter: 'all', published: false };
const toast = $('#toast');

function showToast(message) {
  $('p', toast).textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function showView(name) {
  state.view = name;
  $$('.view').forEach((view) => view.classList.toggle('active', view.dataset.viewPanel === name));
  $$('.nav-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('.nav-trigger, .nav-tab').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));

const formFields = {
  title: $('#taskTitle'),
  problem: $('#taskProblem'),
  audience: $('#taskAudience'),
  category: $('#taskCategory'),
  deadline: $('#taskDeadline'),
  result: $('#taskResult')
};

function setCriterion(name, complete, text) {
  const row = $(`[data-criterion="${name}"]`);
  row.classList.toggle('complete', complete);
  $('b', row).textContent = complete ? 'Готово ✓' : text;
}

function updateReadiness(score) {
  $('#readinessScore').textContent = score;
  $('#headerScore').textContent = `${score}%`;
  $('#scoreCircle span').textContent = `${score}%`;
  $('#readinessProgress').style.width = `${score}%`;
  $('#headerProgress').style.width = `${score}%`;
  $('#scoreCircle').style.background = `radial-gradient(closest-side,#fff 74%,transparent 76% 99%),conic-gradient(var(--purple) ${score}%,#ececf3 0)`;
  $('#readinessLabel').textContent = score >= 80 ? 'Отлично! Задача понятна командам и готова к публикации.' : score >= 60 ? 'Уже неплохо. Добавьте результат и данные, чтобы повысить качество откликов.' : 'Хорошее начало. Заполните основные поля, и AI проверит задачу.';
  setCriterion('problem', formFields.problem.value.trim().length > 25, 'Нужно заполнить');
  setCriterion('audience', formFields.audience.value.trim().length > 2, 'Нужно заполнить');
  setCriterion('data', Boolean(state.dataChoice), 'Не указано');
  setCriterion('result', Boolean(formFields.result.value), 'Не указано');
}

function calculateReadiness(aiBoost = 0) {
  let score = 18;
  if (formFields.title.value.trim().length > 5) score += 12;
  if (formFields.problem.value.trim().length > 25) score += 22;
  if (formFields.audience.value.trim().length > 2) score += 12;
  if (formFields.category.value) score += 8;
  if (state.dataChoice) score += 10;
  if (formFields.deadline.value) score += 7;
  if (formFields.result.value) score += 9;
  score = Math.min(100, score + aiBoost);
  updateReadiness(score);
  return score;
}

Object.values(formFields).forEach((field) => field.addEventListener('input', () => calculateReadiness()));
$$('.choice').forEach((button) => button.addEventListener('click', () => {
  $$(`[data-choice-group="${button.dataset.choiceGroup}"]`).forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  state.dataChoice = button.dataset.value;
  calculateReadiness();
}));

$('#analyzeBtn').addEventListener('click', () => {
  const problem = formFields.problem.value.trim();
  if (problem.length < 15) {
    formFields.problem.focus();
    showToast('Добавьте хотя бы пару предложений о проблеме');
    return;
  }
  const score = calculateReadiness(6);
  $('#aiTipText').textContent = score < 65 ? 'AI советует уточнить, кто сталкивается с проблемой, какие данные уже есть и какой результат можно проверить.' : 'Описание уже понятное. Добавьте измеримую цель — например, сократить время ответа с 20 до 5 минут.';
  openChat(`Я проверила черновик: готовность ${score}%. Самый полезный следующий шаг — уточнить измеримый результат.`);
});

function buildBrief() {
  if (!formFields.title.value.trim() || formFields.problem.value.trim().length < 15) {
    showToast('Заполните название и описание проблемы');
    return;
  }
  const score = Math.max(78, calculateReadiness(10));
  $('#briefTitle').textContent = formFields.title.value.trim();
  $('#briefProblem').textContent = formFields.problem.value.trim();
  $('#briefAudience').textContent = formFields.audience.value.trim() || 'Пользователи и сотрудники организации';
  $('#briefResult').textContent = formFields.result.value || 'Рабочий прототип для проверки основного сценария';
  const dataLabel = { yes: 'данные готовы', partial: 'данные есть частично', no: 'данные нужно собрать' }[state.dataChoice] || 'данные пока не описаны';
  $('#briefResources').textContent = `${formFields.deadline.value || 'Срок уточняется'} · ${dataLabel}`;
  $('#briefScore').textContent = `${score}% готовности`;
  $('#briefPreview').classList.remove('hidden');
  $('#briefPreview').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('#buildBriefBtn').addEventListener('click', buildBrief);
$('#editBriefBtn').addEventListener('click', () => $('.form-card').scrollIntoView({ behavior: 'smooth' }));
$('#publishBtn').addEventListener('click', () => {
  state.published = true;
  showToast('Задача опубликована в каталоге');
  setTimeout(() => showView('catalog'), 700);
});

const taskCards = $$('.task-card');
function filterTasks() {
  const query = $('#catalogSearch').value.trim().toLowerCase();
  let visible = 0;
  taskCards.forEach((card) => {
    const categoryMatch = state.filter === 'all' || card.dataset.category === state.filter;
    const textMatch = card.textContent.toLowerCase().includes(query);
    const show = categoryMatch && textMatch;
    card.classList.toggle('hidden', !show);
    if (show) visible += 1;
  });
  $('#taskCount').textContent = visible;
  $('#emptyState').classList.toggle('hidden', visible !== 0);
}

$('#catalogSearch').addEventListener('input', filterTasks);
$$('.filter').forEach((button) => button.addEventListener('click', () => {
  $$('.filter').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  state.filter = button.dataset.filter;
  filterTasks();
}));

const modal = $('#applyModal');
$$('.apply').forEach((button) => button.addEventListener('click', () => {
  $('#modalTaskTitle').textContent = button.dataset.task;
  modal.classList.remove('hidden');
}));
$$('.modal-close').forEach((button) => button.addEventListener('click', () => modal.classList.add('hidden')));
modal.addEventListener('click', (event) => { if (event.target === modal) modal.classList.add('hidden'); });
$('#sendProposal').addEventListener('click', () => {
  if ($('#proposalText').value.trim().length < 20) return showToast('Добавьте пару предложений об опыте команды');
  modal.classList.add('hidden');
  showToast('Отклик команды kooper отправлен');
});

$$('.choose-team').forEach((button) => button.addEventListener('click', () => {
  $$('.choose-team').forEach((item) => { item.textContent = item.dataset.team === 'kooper' ? 'Выбрать kooper' : 'Выбрать команду'; item.disabled = false; });
  button.textContent = 'Команда выбрана ✓';
  button.disabled = true;
  $('#selectionText').textContent = `Мы уведомили ${button.dataset.team}. Теперь можно перейти к совместной работе.`;
  $('#selectionSuccess').classList.remove('hidden');
  $('#selectionSuccess').scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast(`Команда ${button.dataset.team} выбрана`);
}));
$$('.team-details').forEach((button) => button.addEventListener('click', () => showToast('Профиль команды открыт в демо-режиме')));

const aiChat = $('#aiChat');
const chatMessages = $('#chatMessages');
function addMessage(text, role) {
  const message = document.createElement('div');
  message.className = `message ${role}`;
  message.textContent = text;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}
function openChat(prefill) {
  aiChat.classList.add('open');
  aiChat.setAttribute('aria-hidden', 'false');
  if (prefill) addMessage(prefill, 'bot');
}
function closeChat() { aiChat.classList.remove('open'); aiChat.setAttribute('aria-hidden', 'true'); }
$('#aiFab').addEventListener('click', () => openChat());
$('#closeChat').addEventListener('click', closeChat);
$('.ask-ai-inline').addEventListener('click', () => openChat('kooper лучше совпадает по навыкам: у команды есть RAG, разработка и UX/UI. Это снижает риск разрывов между прототипом и интерфейсом.'));

function aiReply(text) {
  const lower = text.toLowerCase();
  if (lower.includes('опис')) return 'Сфокусируйтесь на трёх вещах: кто сталкивается с проблемой, что происходит сейчас и какой результат будет считаться успехом.';
  if (lower.includes('заполн') || lower.includes('не хватает')) return `Сейчас готовность ${$('#readinessScore').textContent}%. Проверьте аудиторию, наличие данных, срок и формат результата.`;
  if (lower.includes('команд')) return 'Я бы выбрала kooper: совпадение 91%, есть навыки RAG, Python и UX/UI, а предложение содержит понятный двухнедельный план.';
  if (lower.includes('метрик') || lower.includes('результат')) return 'Подходящая метрика: сократить среднее время ответа студенту и долю вопросов, которые требуют участия сотрудника.';
  return 'Поняла. Для сильного брифа уточните пользователя, измеримый результат, доступные данные и ограничения. Могу помочь с любым из этих пунктов.';
}
function sendChat(text) {
  const clean = text.trim();
  if (!clean) return;
  addMessage(clean, 'user');
  const typing = addMessage('Анализирую…', 'bot typing');
  setTimeout(() => { typing.remove(); addMessage(aiReply(clean), 'bot'); }, 550);
}

$('#chatForm').addEventListener('submit', (event) => {
  event.preventDefault();
  sendChat($('#chatInput').value);
  $('#chatInput').value = '';
});
$$('.quick-prompts button').forEach((button) => button.addEventListener('click', () => sendChat(button.textContent)));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeChat(); modal.classList.add('hidden'); } });

calculateReadiness();
