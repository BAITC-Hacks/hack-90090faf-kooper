import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readiness, validateBrief, stages } from './core.mjs';
import { analyzeDraft } from './ai.mjs';
import { assistantReply } from './assistant.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.SANA_DB || resolve(root, 'data/sana.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, contact TEXT UNIQUE, method TEXT, name TEXT, role TEXT, skills TEXT, salt TEXT, password TEXT);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), expires INTEGER);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, owner_id TEXT, body TEXT);
CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), user_id TEXT REFERENCES users(id), body TEXT, UNIQUE(task_id,user_id));
CREATE TABLE IF NOT EXISTS milestones (id TEXT PRIMARY KEY, proposal_id TEXT REFERENCES proposals(id), stage TEXT, body TEXT, UNIQUE(proposal_id,stage));`);
const id = () => randomBytes(12).toString('hex');
const now = () => new Date().toISOString();
const hashToken = token => createHash('sha256').update(token).digest('hex');
const stmt = sql => db.prepare(sql);
const all = table => stmt(`SELECT * FROM ${table}`).all().map(row => JSON.parse(row.body));
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max = 6000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function publicUser(user) {
  if (!user) return null;
  const proposals = all('proposals').filter(p => p.userId === user.id);
  const points = all('milestones').filter(m => m.status === 'approved' && proposals.some(p => p.id === m.proposalId)).reduce((sum, m) => sum + m.points, 0);
  return { id: user.id, name: user.name, role: user.role, contact: user.contact, method: user.method, skills: JSON.parse(user.skills), points };
}
function getTask(taskId) { const row = stmt('SELECT body FROM tasks WHERE id=?').get(taskId); if (!row) fail('Задача не найдена', 404); return JSON.parse(row.body); }
function putTask(task) { stmt('INSERT INTO tasks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(task.id, task.ownerId, JSON.stringify(task)); }
function getProposal(proposalId) { const row = stmt('SELECT body FROM proposals WHERE id=?').get(proposalId); if (!row) fail('Отклик не найден', 404); return JSON.parse(row.body); }
function putProposal(p) { stmt('INSERT INTO proposals VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(p.id, p.taskId, p.userId, JSON.stringify(p)); }
function requireUser(user) { if (!user) fail('Войдите в профиль', 401); return user; }
function requireOwner(user, task) { requireUser(user); if (task.ownerId !== user.id) fail('Изменять задачу может только её автор', 403); }
function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
function normalizeContact(value, method) {
  if (method === 'phone') { const digits = text(value).replace(/\D/g, ''); if (digits.length < 10 || digits.length > 15) fail('Введите полный номер телефона'); return '+' + digits; }
  const email = text(value, 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Проверьте адрес почты'); return email;
}
function profileFields(body) {
  const name = text(body.name, 100); if (name.length < 2) fail('Укажите имя или название команды');
  if (!['Бизнес','Специалист','Команда'].includes(body.role)) fail('Выберите роль');
  const skills = Array.isArray(body.skills) ? body.skills.map(s => text(s, 50)).filter(Boolean).slice(0, 20) : [];
  return { name, role: body.role, skills: JSON.stringify(skills) };
}
// Clearly marked sample briefs; no fabricated applications or users.
if (!stmt('SELECT id FROM tasks LIMIT 1').get()) {
  const samples = [
    ['AI-помощник для ответов студентам','Образование','Сотрудники повторно отвечают на частые вопросы студентов. Нужно сократить ожидание ответа.',['Python','RAG','UX/UI']],
    ['Анализ обращений жителей','Город','Нужно находить повторяющиеся городские проблемы в обращениях жителей и составлять отчёты.',['NLP','API','Analytics']],
    ['Прогноз спроса на товары','Ритейл','Закупщики ошибаются при планировании запасов. Нужно снизить списания товаров.',['ML','Data','Python']],
    ['Персональная траектория обучения','Образование','Студентам трудно выбирать практические задания, подходящие их уровню и интересам.',['Web','JavaScript','UX/UI']],
    ['Умный поиск по документам','Город','Сотрудники долго ищут нужные регламенты и ответы в документах учреждения.',['Search','RAG','Python']],
    ['Анализ отзывов покупателей','Ритейл','Менеджеры вручную читают отзывы и пропускают повторяющиеся жалобы покупателей.',['NLP','Analytics','Data']]
  ];
  samples.forEach(([title, category, problem, tags], index) => {
    const fields = { title, category, problem, audience: 'Сотрудники и пользователи организации', result: 'Рабочий прототип', data: 'partial', deadline: 'До месяца', goal: index % 2 ? '' : 'Сократить время обработки обращений на 30%', resources: 'Обезличенные примеры обращений; доступ согласуется с заказчиком', limits: '', owner: '' };
    putTask({ id: `sample-${index}`, ownerId: 'sample', ownerName: 'Учебный пример', fields, tags, questions: [], answers: {}, score: readiness(fields,true).score, status: 'published', revision: 1, example: true, createdAt: now(), decision: null });
  });
}

const attempts = new Map();
async function route(req, res, path, user, body, token) {
  if (req.method === 'GET' && path === '/api/state') {
    const tasks = all('tasks').filter(t => t.status === 'published' || t.ownerId === user?.id).map(t=>({...t,score:readiness(t.fields,['confirmed','published'].includes(t.status)).score})).sort((a,b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt));
    const proposals = user ? all('proposals').filter(p => p.userId === user.id || tasks.some(t => t.id === p.taskId && t.ownerId === user.id)) : [];
    const milestones = all('milestones').filter(m => proposals.some(p => p.id === m.proposalId));
    return { me: publicUser(user), tasks, proposals, milestones };
  }
  if (req.method !== 'POST') fail('Не найдено', 404);
  if (path === '/api/assistant') {
    const query=text(body.query,2000); if(!query)fail('Напишите запрос помощнику');
    const fields={};
    for(const key of ['title','problem','audience','category','data','deadline','result','goal','resources','limits','contact','consultation','feedback'])fields[key]=text(body.fields?.[key]);
    const tasks=all('tasks').filter(t=>t.status==='published').map(t=>({...t,score:readiness(t.fields,true).score}));
    return assistantReply({query,fields,tasks,skills:user?JSON.parse(user.skills):[],previousSearch:text(body.previousSearch,2000)});
  }
  if (path === '/api/register' || path === '/api/login') {
    const ip = req.socket.remoteAddress;
    const recent = (attempts.get(ip) || []).filter(t => Date.now() - t < 60000); attempts.set(ip, recent);
    if (recent.length >= 20) fail('Слишком много попыток. Подождите минуту.', 429);
    recent.push(Date.now());
    const method = body.method === 'phone' ? 'phone' : 'email';
    const contact = normalizeContact(body.contact, method);
    const password = text(body.password, 256);
    let account;
    if (path === '/api/register') {
      if (password.length < 8) fail('Пароль должен содержать минимум 8 символов');
      if (stmt('SELECT id FROM users WHERE contact=?').get(contact)) fail('Этот контакт уже зарегистрирован. Выберите «Войти».', 409);
      const fields = profileFields(body), salt = randomBytes(16).toString('hex');
      account = { id: id(), contact, method, ...fields, salt, password: scryptSync(password, salt, 64).toString('hex') };
      stmt('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(account.id, contact, method, fields.name, fields.role, fields.skills, salt, account.password);
    } else {
      account = stmt('SELECT * FROM users WHERE contact=?').get(contact);
      const salt = account?.salt || 'unknown-account';
      const actual = scryptSync(password, salt, 64);
      if (!account || !timingSafeEqual(actual, Buffer.from(account.password, 'hex'))) fail('Неверный контакт или пароль', 401);
    }
    if (token) stmt('DELETE FROM sessions WHERE token=?').run(hashToken(token));
    const session = randomBytes(32).toString('hex');
    stmt('INSERT INTO sessions VALUES (?,?,?)').run(hashToken(session), account.id, Date.now() + 7 * 86400000);
    res.setHeader('Set-Cookie', `sana_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
    return { me: publicUser(account) };
  }
  if (path === '/api/logout') { if (token) stmt('DELETE FROM sessions WHERE token=?').run(hashToken(token)); res.setHeader('Set-Cookie','sana_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return { ok: true }; }
  requireUser(user);
  if (path === '/api/profile') {
    const f = profileFields(body);
    // Changing roles is allowed, but existing record ownership never changes.
    stmt('UPDATE users SET name=?,role=?,skills=? WHERE id=?').run(f.name, f.role, f.skills, user.id);
    return { me: publicUser(stmt('SELECT * FROM users WHERE id=?').get(user.id)) };
  }
  if (path === '/api/tasks/save') {
    if (user.role !== 'Бизнес') fail('Создавать задачи может профиль бизнеса', 403);
    const previous = body.id ? getTask(body.id) : null;
    if (previous) { requireOwner(user, previous); if (previous.status === 'published') fail('Опубликованная карточка уже доступна командам. Создайте новый черновик.'); }
    const fields = {};
    for (const key of ['title','problem','audience','category','data','deadline','result','goal','resources','limits','owner','contact','consultation','feedback','scope','validation','risks']) fields[key] = text(body.fields?.[key]);
    const answers = {}; for (const [key,value] of Object.entries(body.answers || {})) if (Object.hasOwn(fields,key)) answers[key] = text(value);
    const analysis = body.analyze ? await analyzeDraft(fields) : null;
    const questions = analysis ? analysis.questions : previous?.questions || [];
    const task = { id: previous?.id || id(), ownerId: user.id, ownerName: user.name, fields, tags: text(body.tags, 500).split(',').map(s=>s.trim()).filter(Boolean).slice(0,12), questions, answers, score: readiness(fields).score, status: 'draft', revision: (previous?.revision || 0) + 1, createdAt: previous?.createdAt || now(), decision: null };
    putTask(task); return { task, analysis:analysis?{mode:analysis.mode,notice:analysis.notice}:null };
  }
  if (path === '/api/tasks/confirm' || path === '/api/tasks/publish') {
    const task = getTask(body.id); requireOwner(user, task);
    if (task.revision !== body.revision) fail('Карточка изменилась. Обновите страницу и подтвердите новую версию.', 409);
    const error = validateBrief(task); if (error) fail(error);
    if (path.endsWith('/publish')) {
      if (task.status === 'published') return { task };
      if (task.status !== 'confirmed') fail('Сначала подтвердите карточку');
      task.status = 'published'; task.publishedAt = now();
    } else { if (task.status === 'published') fail('Задача уже опубликована'); task.status = 'confirmed'; }
    task.score = readiness(task.fields,true).score; putTask(task); return { task };
  }
  if (path === '/api/proposals/save') {
    const task = getTask(body.taskId);
    if (task.status !== 'published' || task.example) fail('Для отклика выберите опубликованную бизнесом задачу');
    if (task.ownerId === user.id || user.role === 'Бизнес') fail('Отклик отправляет специалист или команда', 403);
    if (task.decision !== null) fail('Приём предложений по этой задаче завершён');
    const proposalText = text(body.text); if (proposalText.length < 20) fail('Опишите предложение минимум в 20 символах');
    const row = stmt('SELECT body FROM proposals WHERE task_id=? AND user_id=?').get(task.id, user.id);
    const old = row ? JSON.parse(row.body) : null;
    const proposal = { id: old?.id || id(), taskId: task.id, userId: user.id, teamName: user.name, skills: JSON.parse(user.skills), text: proposalText, timeline: text(body.timeline,200), status:'review', createdAt: old?.createdAt || now(), updatedAt: now() };
    putProposal(proposal); return { proposal };
  }
  if (path === '/api/proposals/withdraw') {
    const p = getProposal(body.id); if (p.userId !== user.id) fail('Это не ваш отклик', 403);
    if (p.status !== 'review') fail('Можно отозвать только предложение на рассмотрении');
    p.status = 'withdrawn'; putProposal(p); return { proposal:p };
  }
  if (path === '/api/tasks/decision') return transaction(() => {
    const task = getTask(body.id); requireOwner(user,task);
    if (task.status !== 'published' || task.example) fail('Сначала опубликуйте задачу');
    if (task.decision !== null) fail('Решение уже подтверждено. Обновите страницу.',409);
    const selected = Array.isArray(body.selected) ? [...new Set(body.selected)] : [];
    const proposals = all('proposals').filter(p=>p.taskId===task.id && p.status==='review');
    if (selected.some(pid=>!proposals.some(p=>p.id===pid))) fail('Нельзя выбрать отсутствующий или отозванный отклик');
    task.decision = { selected, confirmedAt: now() }; putTask(task);
    proposals.forEach(p=> { p.status=selected.includes(p.id)?'accepted':'rejected'; putProposal(p); });
    return { task };
  });
  if (path === '/api/milestones/submit') {
    const p = getProposal(body.proposalId); if (p.userId !== user.id || p.status !== 'accepted') fail('Результат отправляет выбранная команда',403);
    const stageIndex = stages.findIndex(s=>s.key===body.stage); if (stageIndex < 0) fail('Неизвестный этап');
    const stage = stages[stageIndex];
    const progress = all('milestones').filter(m=>m.proposalId===p.id);
    if (stages.slice(0,stageIndex).some(s=>!progress.some(m=>m.stage===s.key && m.status==='approved'))) fail('Дождитесь подтверждения предыдущего этапа');
    const existing = progress.find(m=>m.stage===stage.key); if (existing && existing.status!=='revision') fail('Этот этап уже отправлен или подтверждён',409);
    const evidence = text(body.evidence); if (evidence.length < 20) fail('Опишите сделанное и добавьте доказательство результата (от 20 символов)');
    const m = { id: existing?.id || id(), proposalId:p.id, stage:stage.key, title:stage.title, evidence, status:'submitted', points:stage.points, submittedAt:now(), feedback:'' };
    stmt('INSERT INTO milestones VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(m.id,p.id,stage.key,JSON.stringify(m)); return { milestone:m };
  }
  if (path === '/api/milestones/review') return transaction(() => {
    const row = stmt('SELECT body FROM milestones WHERE id=?').get(body.id); if (!row) fail('Этап не найден',404);
    const m = JSON.parse(row.body), p = getProposal(m.proposalId); requireOwner(user,getTask(p.taskId));
    if (m.status !== 'submitted') fail('Этот этап уже проверен',409);
    if (!['approve','revision'].includes(body.action)) fail('Выберите решение');
    if (body.action==='revision' && text(body.feedback).length < 5) fail('Напишите, что нужно доработать');
    m.status = body.action==='approve'?'approved':'revision'; m.reviewedAt=now(); m.feedback=text(body.feedback);
    stmt('UPDATE milestones SET body=? WHERE id=?').run(JSON.stringify(m),m.id); return { milestone:m };
  });
  fail('Не найдено',404);
}
const allowed = new Set(['/index.html','/style.css','/app.js','/core.mjs']);
const server = http.createServer(async (req,res) => {
  try {
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Cache-Control','no-store');
    const path = new URL(req.url,'http://localhost').pathname;
    if (!path.startsWith('/api/')) {
      const file = path==='/'?'/index.html':path; if(!allowed.has(file)) fail('Не найдено',404);
      res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8'})[extname(file)]);
      res.end(readFileSync(resolve(root,'.'+file))); return;
    }
    if (req.method==='POST' && req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) fail('Запрос с другого сайта запрещён',403);
    const token = req.headers.cookie?.match(/(?:^|;\s*)sana_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const user = token ? stmt('SELECT users.* FROM users JOIN sessions ON sessions.user_id=users.id WHERE sessions.token=? AND sessions.expires>?').get(hashToken(token),Date.now()) : null;
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length>100000) fail('Слишком большой запрос',413); }
    let body; try { body=raw?JSON.parse(raw):{}; } catch { fail('Некорректный JSON'); }
    if (!body || typeof body!=='object' || Array.isArray(body)) fail('Некорректный запрос');
    const result = await route(req,res,path,user,body,token);
    res.setHeader('Content-Type','application/json; charset=utf-8'); res.end(JSON.stringify(result));
  } catch(error) {
    res.statusCode=error.status || 500; res.setHeader('Content-Type','application/json; charset=utf-8');
    if (!error.status) console.error(error);
    res.end(JSON.stringify({ error:error.status?error.message:'Не удалось выполнить действие. Попробуйте ещё раз.' }));
  }
});
const port = Number(process.env.PORT || 8765);
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`AI Sana http://127.0.0.1:${server.address().port}`));
