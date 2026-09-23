import {randomBytes,scryptSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readiness,questionsFor} from './core.mjs';

export const fixtures=JSON.parse(readFileSync(new URL('./fixtures/synthetic.json',import.meta.url),'utf8'));
export const demoAccounts=[{id:'demo-business',name:'Демо-бизнес',role:'Бизнес',skills:[],interests:[],technologies:[]},...fixtures.teams.map(t=>({...t,role:'Команда'}))];
export const demoTaskId=id=>'demo-task-'+id;
export function seedDemo(db) {
  db.exec('CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY, body TEXT);');
  if(db.prepare('SELECT id FROM migrations WHERE id=?').get('synthetic-v1'))return;
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const account of demoAccounts) {
      const salt=randomBytes(16).toString('hex'),password=scryptSync(randomBytes(32),salt,64).toString('hex');
      db.prepare('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?,?,?)').run(account.id,account.id+'@demo.example','email',account.name,account.role,JSON.stringify(account.skills),salt,password);
      db.prepare('INSERT OR IGNORE INTO profiles VALUES (?,?)').run(account.id,JSON.stringify({interests:account.interests,technologies:account.technologies}));
    }
    const base={ownerId:'demo-business',ownerName:'Демо-бизнес',example:true,revision:1,createdAt:new Date().toISOString(),decision:null};
    for(const item of fixtures.tasks) {
      const task={...base,id:demoTaskId(item.id),fields:item.fields,tags:item.tags,questions:[],answers:{},score:readiness(item.fields,true).score,status:'published'};
      db.prepare('INSERT OR IGNORE INTO tasks VALUES (?,?,?)').run(task.id,task.ownerId,JSON.stringify(task));
    }
    for(const item of fixtures.drafts) {
      const fields={...item.fields,problem:item.text,category:item.industry};
      const task={...base,id:'demo-'+item.id,fields,tags:[],questions:questionsFor(fields),answers:{},score:0,status:'draft'};
      db.prepare('INSERT OR IGNORE INTO tasks VALUES (?,?,?)').run(task.id,task.ownerId,JSON.stringify(task));
    }
    for(const item of fixtures.proposals) {
      const team=fixtures.teams.find(t=>t.id===item.teamId);
      const proposal={id:item.id,taskId:demoTaskId(item.taskId),userId:item.teamId,teamName:team.name,skills:team.skills,interests:team.interests,technologies:team.technologies,text:item.idea,plan:item.plan,timeline:item.deadline,link:item.link,status:'review',example:true,createdAt:base.createdAt,updatedAt:base.createdAt};
      db.prepare('INSERT OR IGNORE INTO proposals VALUES (?,?,?,?)').run(proposal.id,proposal.taskId,proposal.userId,JSON.stringify(proposal));
    }
    // Old synthetic cards remain available and get a demo owner who can review their proposals.
    for(const row of db.prepare('SELECT id,body FROM tasks WHERE owner_id=?').all('sample')) {
      const task=JSON.parse(row.body);if(!task.example)continue;
      task.ownerId=base.ownerId;task.ownerName=base.ownerName;
      db.prepare('UPDATE tasks SET owner_id=?,body=? WHERE id=?').run(task.ownerId,JSON.stringify(task),task.id);
    }
    db.prepare('INSERT INTO migrations VALUES (?)').run('synthetic-v1');db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
