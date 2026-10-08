// A separate metadata branch leaves main and the running checkout untouched.
import { spawnSync } from 'node:child_process';
const previewUrl = process.env.PREVIEW_URL;
const status = process.env.PREVIEW_STATUS;
if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(previewUrl || '')) throw new Error('Unexpected preview URL');
if (!['online', 'offline'].includes(status)) throw new Error('Unexpected status');
const git = (args, input) => {
  const result = spawnSync('git', args, {
    input, encoding: 'utf8', env: { ...process.env,
      GIT_AUTHOR_NAME: 'github-actions[bot]', GIT_COMMITTER_NAME: 'github-actions[bot]',
      GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
      GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
    },
  });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
};
const ref = 'refs/heads/preview-live';
let previous;
if (git(['ls-remote', 'origin', ref])) {
  git(['fetch', 'origin', ref]);
  previous = git(['rev-parse', 'FETCH_HEAD']);
}
const sourceCommit = process.env.GITHUB_SHA || git(['rev-parse', 'HEAD']);
let prior;
if (previous) prior = JSON.parse(git(['show', `${previous}:preview.json`]));
if (status === 'offline' && (prior?.url !== previewUrl || prior?.sourceCommit !== sourceCommit)) {
  console.log('A newer preview owns the metadata; leave it unchanged.');
  process.exit(0);
}
const startedAt = status === 'online' ? new Date().toISOString() : prior.startedAt;
const metadata = {
  status, url: previewUrl, sourceCommit, startedAt,
  expiresAt: status === 'online' ? new Date(Date.now() + 30 * 60_000).toISOString() : prior.expiresAt,
  updatedAt: new Date().toISOString(),
  storage: 'Temporary SQLite on this preview runner; separate from the development database.',
};
const blob = git(['hash-object', '-w', '--stdin'], `${JSON.stringify(metadata, null, 2)}\n`);
const tree = git(['mktree'], `100644 blob ${blob}\tpreview.json\n`);
const commit = git(['commit-tree', tree, ...(previous ? ['-p', previous] : []), '-m', `Preview ${status}`]);
git(['push', 'origin', `${commit}:${ref}`]);
console.log(`Preview metadata published: ${status}`);
