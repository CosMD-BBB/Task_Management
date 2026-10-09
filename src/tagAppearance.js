// One palette drives the task picker, saved labels, and every workspace view.
// Foregrounds stay readable on the same saturated fills in either theme.
const channelAppearances = {
  facebook: { color: '#0866FF', foreground: '#FFFFFF' },
  instagram: { color: '#C13584', background: 'linear-gradient(115deg, #833AB4 0%, #C13584 100%)', foreground: '#FFFFFF', accent: '#FF9F43' },
  tiktok: { color: '#101015', foreground: '#FFFFFF', accent: 'linear-gradient(180deg, #25F4EE 0%, #25F4EE 48%, #FE2C55 52%, #FE2C55 100%)' },
  youtube: { color: '#E70023', foreground: '#FFFFFF' },
  line: { color: '#06C755', foreground: '#06200D' },
  website: { color: '#006A9C', foreground: '#FFFFFF' },
  other: { color: '#475569', foreground: '#FFFFFF' },
};

const contentAppearances = {
  video: { color: '#E11D48', foreground: '#FFFFFF' },
  'photo album': { color: '#7C3AED', foreground: '#FFFFFF' },
  infographic: { color: '#0077B6', foreground: '#FFFFFF' },
  'single post': { color: '#F59E0B', foreground: '#321E03' },
  reel: { color: '#C026D3', foreground: '#FFFFFF' },
  story: { color: '#EA580C', foreground: '#2A1004' },
  'ขายของ': { color: '#16A34A', foreground: '#06200D' },
  blog: { color: '#2563EB', foreground: '#FFFFFF' },
  other: { color: '#334155', foreground: '#FFFFFF' },
};

const customColors = ['#BE123C', '#7C3AED', '#0369A1', '#C2410C', '#047857', '#A21CAF', '#1D4ED8', '#9F1239', '#0E7490', '#92400E', '#4338CA', '#166534'];

function normalizedValue(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function customAppearance(value, kind) {
  let hash = 2166136261;
  for (const character of `${kind}:${value}`) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
  return { color: customColors[hash % customColors.length], foreground: '#FFFFFF' };
}

export function getTagAppearance(value, kind = 'contentType') {
  const token = normalizedValue(value);
  const isChannel = kind === 'channel' || kind === 'channels';
  const aliases = isChannel
    ? { fb: 'facebook', ig: 'instagram', yt: 'youtube', 'line oa': 'line', 'tik tok': 'tiktok', 'เฟซบุ๊ก': 'facebook', 'อินสตาแกรม': 'instagram' }
    : { vdo: 'video', 'วิดีโอ': 'video', 'ภาพ': 'photo album', 'รูปภาพ': 'photo album', 'อัลบั้มภาพ': 'photo album', 'อินโฟกราฟิก': 'infographic', 'ภาพเดี่ยว': 'single post', 'บทความ': 'blog' };
  const canonical = aliases[token] || (!isChannel && token.startsWith('single post (') ? 'single post' : token);
  const palette = isChannel ? channelAppearances : contentAppearances;
  const appearance = palette[canonical] || customAppearance(token, isChannel ? 'channel' : 'contentType');
  return { ...appearance, background: appearance.background || appearance.color, accent: appearance.accent || appearance.color };
}

export function tagAppearanceStyle(value, kind = 'contentType') {
  const appearance = getTagAppearance(value, kind);
  return {
    '--tag-color': appearance.color,
    '--tag-background': appearance.background,
    '--tag-foreground': appearance.foreground,
    '--tag-accent': appearance.accent,
  };
}
