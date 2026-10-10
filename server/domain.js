/** Preserve the first display label while treating spelling/case variants as one tag. */
export function uniqueTags(values = []) {
  const seen = new Set();
  return values.map((value) => typeof value === 'string' ? value.trim() : value).filter((value) => {
    const key = typeof value === 'string' ? value.toLocaleLowerCase('en-US') : value;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeTaskInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const output = { ...value };
  for (const [array, legacy, tags] of [
    ['assigneeIds', 'assigneeId', false], ['contentTypes', 'contentType', true], ['channels', 'channel', true],
  ]) {
    if (Object.hasOwn(output, array)) {
      if (Array.isArray(output[array])) output[array] = tags ? uniqueTags(output[array]) : [...new Set(output[array])];
    } else if (Object.hasOwn(output, legacy)) {
      output[array] = output[legacy] === null && !tags || output[legacy] === '' && tags ? [] : [output[legacy]];
      if (tags) output[array] = uniqueTags(output[array]);
    }
    delete output[legacy];
  }
  return output;
}

export function normalizeStoredTask(value) {
  const task = normalizeTaskInput(value);
  const assigneeIds = task.assigneeIds ?? [];
  const contentTypes = task.contentTypes ?? [];
  const channels = task.channels ?? [];
  return {
    ...task, assigneeIds, contentTypes, channels,
    assigneeId: assigneeIds[0] ?? null, contentType: contentTypes[0] ?? '', channel: channels[0] ?? '',
  };
}

export function sameScope(user, owner) {
  return (user.demo_scope_id ?? null) === (owner.demo_scope_id ?? null);
}

/** Every task write gets a newer version, including writes within the same millisecond. */
export function nextUpdatedAt(previous) {
  const timestamp = Date.parse(previous ?? '');
  return new Date(Math.max(Date.now(), Number.isFinite(timestamp) ? timestamp + 1 : 0)).toISOString();
}

/** Safe, repeatable migration of existing JSON tasks and durable tag catalogs. */
export async function migrateDomainData(db) {
  await db.transaction(async (tx) => {
    const legacyDemoUsers = await tx.all("SELECT id, email FROM users WHERE demo_scope_id IS NULL AND password_hash = '!demo-only-no-login' AND email LIKE 'demo-%@example.invalid'");
    for (const user of legacyDemoUsers) {
      const match = user.email.match(/^demo-([a-f0-9]{8})-(\d+)@example\.invalid$/);
      if (match) await tx.run("UPDATE users SET demo_scope_id = ?, email_verified = 1, email_verified_mode = 'preview', global_role = ? WHERE id = ?", [
        `legacy-demo-${match[1]}`, match[2] === '0' ? 'superadmin' : 'member', user.id,
      ]);
    }
    const projects = await tx.all(`SELECT id, content_type_options_json, channel_options_json FROM projects${tx.kind === 'postgres' ? ' FOR UPDATE' : ''}`);
    for (const project of projects) {
      let contentTypes = JSON.parse(project.content_type_options_json || '[]');
      let channels = JSON.parse(project.channel_options_json || '[]');
      const rows = await tx.all('SELECT id, data_json FROM tasks WHERE project_id = ?', [project.id]);
      for (const row of rows) {
        const task = normalizeStoredTask(JSON.parse(row.data_json));
        const json = JSON.stringify(task);
        if (json !== row.data_json) await tx.run('UPDATE tasks SET data_json = ? WHERE id = ? AND data_json = ?', [json, row.id, row.data_json]);
        contentTypes = uniqueTags([...contentTypes, ...task.contentTypes]);
        channels = uniqueTags([...channels, ...task.channels]);
      }
      await tx.run('UPDATE projects SET content_type_options_json = ?, channel_options_json = ? WHERE id = ?', [
        JSON.stringify(contentTypes), JSON.stringify(channels), project.id,
      ]);
    }
  });
}
