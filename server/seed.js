import { randomUUID } from 'node:crypto';
import { normalizeStoredTask, uniqueTags } from './domain.js';

function dateOffset(days) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function seedDemo(db) {
  return db.transaction((tx) => seedDemoData(tx));
}

async function seedDemoData(db) {
  const suffix = randomUUID().slice(0, 8);
  const demoScopeId = randomUUID();
  const now = new Date().toISOString();
  const people = [
    { name: 'Alex Morgan', avatar_color: '#f97316' },
    { name: 'พิมพ์ชนก', avatar_color: '#a78bfa' },
    { name: 'Nat Studio', avatar_color: '#38bdf8' },
    { name: 'Sarah Chen', avatar_color: '#34d399' },
  ].map((person, index) => ({
    ...person, id: randomUUID(), email: `demo-${suffix}-${index}@example.invalid`,
    global_role: index === 0 ? 'superadmin' : 'member', email_verified: 1, disabled_at: null, demo_scope_id: demoScopeId,
  }));
  for (const person of people) {
    await db.run(`INSERT INTO users (id, name, email, password_hash, avatar_color, created_at, global_role, email_verified, demo_scope_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      person.id, person.name, person.email, '!demo-only-no-login', person.avatar_color, now,
      person.global_role, person.email_verified, person.demo_scope_id,
    ]);
    await db.run("UPDATE users SET email_verified_mode = 'preview' WHERE id = ?", [person.id]);
  }
  const projects = [
    {
      id: randomUUID(), name: 'Regagar', description: 'Content planning, creative production & social campaigns for Regagar.',
      color: '#fb923c', fields: [{ id: 'campaign', name: 'Campaign', type: 'select', options: ['Always-on', 'Product Launch', 'October Sale'] }],
    },
    {
      id: randomUUID(), name: 'Website Launch', description: 'Building a thoughtful new home for our brand.',
      color: '#a78bfa', fields: [{ id: 'section', name: 'Section', type: 'text', options: [] }],
    },
    { id: randomUUID(), name: 'Team Operations', description: 'A little structure for our everyday work.', color: '#34d399', fields: [] },
  ];
  for (const [projectIndex, project] of projects.entries()) {
    const owner = people[projectIndex === 2 ? 3 : 0];
    await db.run('INSERT INTO projects (id, name, description, color, owner_id, fields_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      project.id, project.name, project.description, project.color, owner.id, JSON.stringify(project.fields), now,
    ]);
    for (const person of people.filter((person) => person.id !== owner.id)) {
      await db.run('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)', [project.id, person.id, 'editor']);
    }
  }
  const mainTasks = [
    ['Remind FAQ : ปัญหาผิวลูกน้อยแบบไหนที่ต้องดูแล', 'scheduled', 'normal', 2, 'Single Post (สินค้า)', 'Facebook', 1],
    ['Album Sale BALM : FACIAL BALM เพื่อผิวที่อ่อนโยน', 'scheduled', 'high', 3, 'Photo album', 'Facebook', 2],
    ['Remind FAQ : ผดร้อนกระจาย ทั้งผิวหน้าและตัว', 'scheduled', 'normal', 4, 'Single Post (สินค้า)', 'Facebook', 1],
    ['Sale FOAM : ผิวกายระคายเคือง มีตุ่มน้ำใส', 'scheduled', 'normal', 5, 'Single Post (สินค้า)', 'Facebook', 3],
    ['Sale All : 1 วันของผิวลูก ตั้งแต่ตื่นจนเข้านอน', 'scheduled', 'high', 7, 'Single Post (สินค้า)', 'Facebook', 2],
    ['Info : ตุ่มบนผิวลูกแบบนี้ เรียกว่าอะไร', 'scheduled', 'low', 9, 'Infographic', 'Facebook', 1],
    ['TikTok : โลชั่น 9 เคล็ดลับดูแลผิวลูก', 'review', 'urgent', 0, 'VDO', 'TikTok', 2],
    ['TikTok : Oil Milk NEW — First look', 'review', 'high', 1, 'VDO', 'TikTok', 3],
    ['TikTok Remind : เลือกของใช้ให้ลูก อันไหนดีที่สุด', 'review', 'normal', 2, 'VDO', 'TikTok', 2],
    ['October campaign — creative direction', 'in_progress', 'high', 1, 'Photo album', 'Instagram', 0],
    ['Skincare routine : Morning to bedtime', 'in_progress', 'normal', 3, 'VDO', 'Instagram', 3],
    ['Product photography — Facial Balm', 'in_progress', 'urgent', -1, 'Photo album', 'Facebook', 2],
    ['เขียน Content brief สำหรับแคมเปญเดือนใหม่', 'todo', 'high', 5, 'Single Post (สินค้า)', 'Facebook', 1],
    ['Plan November content calendar', 'todo', 'normal', 12, 'Infographic', 'Instagram', 0],
    ['Customer stories — interview outline', 'todo', 'low', 8, 'VDO', 'TikTok', 3],
    ['Monthly performance report', 'todo', 'normal', 14, 'Infographic', 'Facebook', 0],
    ['September wrap-up & learnings', 'done', 'normal', -3, 'Infographic', 'Facebook', 0],
    ['Brand guidelines — final approval', 'done', 'high', -2, 'Photo album', 'Instagram', 1],
  ];
  const taskGroups = [
    mainTasks,
    [
      ['Homepage wireframes', 'done', 'high', -2, 'Design', 'Website', 2],
      ['Build product collection page', 'in_progress', 'high', 4, 'Development', 'Website', 0],
      ['Review mobile checkout experience', 'review', 'urgent', 2, 'Design', 'Website', 3],
      ['Prepare launch announcement', 'todo', 'normal', 7, 'Single Post (สินค้า)', 'Instagram', 1],
    ],
    [
      ['Weekly team sync — agenda', 'todo', 'normal', 1, 'Meeting', '', 0],
      ['Update content production checklist', 'in_progress', 'low', 5, 'Documentation', '', 1],
    ],
  ];
  for (const [projectIndex, entries] of taskGroups.entries()) {
    for (const [index, entry] of entries.entries()) {
      const [title, status, priority, days, contentType, channel, personIndex] = entry;
      const project = projects[projectIndex];
      const task = normalizeStoredTask({
        id: randomUUID(), projectId: project.id, title,
        description: projectIndex === 0
          ? 'วางแผนคอนเทนต์ให้สอดคล้องกับ Brand voice เน้นข้อมูลที่เข้าใจง่าย พร้อมส่งทีมตรวจสอบก่อนเผยแพร่\n\nKey message: Gentle care, every day.\nDeliverables: Copy, visual direction และ final artwork.'
          : 'Coordinate with the team, share the latest work, and check off the steps before the due date.',
        status, priority, dueDate: dateOffset(days), assigneeId: people[personIndex].id, contentType, channel,
        links: index % 3 === 0 ? [{ label: 'Creative reference', url: 'https://www.figma.com/' }, { label: 'Content files', url: 'https://drive.google.com/' }] : [],
        subtasks: index % 2 === 0 ? [
          { id: randomUUID(), title: 'Prepare brief & references', done: status !== 'todo' },
          { id: randomUUID(), title: 'Create copy and first draft', done: ['scheduled', 'done', 'review'].includes(status) },
          { id: randomUUID(), title: 'Team review & final approval', done: ['scheduled', 'done'].includes(status) },
        ] : [],
        customFields: projectIndex === 0 ? { campaign: index % 3 === 0 ? 'October Sale' : index % 3 === 1 ? 'Product Launch' : 'Always-on' }
          : projectIndex === 1 ? { section: index < 2 ? 'Storefront' : 'Launch' } : {},
        createdAt: new Date(Date.now() - (entries.length - index) * 60 * 1000).toISOString(), updatedAt: now,
      });
      await db.run('INSERT INTO tasks (id, project_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
        task.id, task.projectId, JSON.stringify(task), task.createdAt, task.updatedAt,
      ]);
      if (projectIndex === 0 && index === 0) {
        const sampleComments = [
          { author: people[1], kind: 'caption', body: 'ดูแลผิวลูกน้อยอย่างอ่อนโยนในทุกวัน 💛\nเคล็ดลับง่าย ๆ ที่คุณพ่อคุณแม่เริ่มได้วันนี้\n\n#Regagar #GentleCare', mentions: [] },
          { author: people[2], kind: 'comment', body: `@${people[1].name} แนบตัวอย่างภาพแล้ว ช่วยตรวจแคปชั่นก่อนส่งทีมอนุมัติได้เลย`,
            mentions: [{ userId: people[1].id, start: 0, end: people[1].name.length + 1, name: people[1].name }] },
          { author: people[0], kind: 'revision', body: 'ปรับหัวข้อให้อ่านง่ายขึ้นบนมือถือ และเพิ่มข้อความแนะนำวิธีใช้ในภาพสุดท้าย', mentions: [] },
        ];
        for (const [commentIndex, comment] of sampleComments.entries()) {
          const createdAt = new Date(Date.now() - (sampleComments.length - commentIndex) * 60 * 1000).toISOString();
          await db.run(`INSERT INTO task_comments (id, task_id, project_id, author_id, author_name, author_avatar_color, body, kind, mentions_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            randomUUID(), task.id, project.id, comment.author.id, comment.author.name, comment.author.avatar_color,
            comment.body, comment.kind, JSON.stringify(comment.mentions), createdAt, createdAt,
          ]);
        }
      }
      if (projectIndex === 0 && index === 9) {
        await db.run(`INSERT INTO notifications (id, user_id, actor_id, project_id, task_id, type, title, body, created_at, read_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          randomUUID(), people[0].id, people[1].id, project.id, task.id, 'assignment', task.title,
          `${people[1].name} มอบหมายงานให้คุณในโปรเจกต์ ${project.name}`, now, null,
        ]);
      }
    }
    const entriesForProject = taskGroups[projectIndex];
    await db.run('UPDATE projects SET content_type_options_json = ?, channel_options_json = ? WHERE id = ?', [
      JSON.stringify(uniqueTags(entriesForProject.map((entry) => entry[4]).filter(Boolean))),
      JSON.stringify(uniqueTags(entriesForProject.map((entry) => entry[5]).filter(Boolean))), projects[projectIndex].id,
    ]);
  }
  return people[0];
}
