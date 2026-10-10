import { z } from 'zod';
import { uniqueTags } from './domain.js';

const name = z.string().trim().min(1).max(120);
const email = z.string().trim().toLowerCase().email().max(254);
const id = z.string().min(1).max(100).regex(/^[\w-]+$/);
// bcrypt authenticates at most 72 bytes; reject longer passwords rather than truncate.
const password = z.string().max(72).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes');
export const registerSchema = z.object({ name, email, password: password.min(8) }).strict();
export const loginSchema = z.object({ email, password: password.min(1) }).strict();

const field = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  type: z.enum(['text', 'select']),
  options: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
}).strict();
const tag = z.string().trim().min(1).max(100);
const tagOptions = z.array(tag).max(200).transform(uniqueTags);
const coverImage = z.string().max(600 * 1024).refine((value) => {
  if (value === '') return true;
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return true;
  try { return value.length <= 2048 && new URL(value).protocol === 'https:'; }
  catch { return false; }
}, 'Use a PNG, JPEG or WebP image under 600 KB, or a valid HTTPS URL').nullable().transform((value) => value || null);
export const projectSchema = z.object({
  name,
  description: z.string().max(4000).default(''),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#f97316'),
  fields: z.array(field).max(12).default([]),
  coverImage: coverImage.default(null),
  contentTypeOptions: tagOptions.default([]),
  channelOptions: tagOptions.default([]),
}).strict().refine((project) => new Set(project.fields.map((entry) => entry.id)).size === project.fields.length, {
  message: 'Custom fields must have unique IDs', path: ['fields'],
});
export const projectPatchSchema = z.object({
  name: name.optional(),
  description: z.string().max(4000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fields: z.array(field).max(12).optional(),
  coverImage: coverImage.optional(),
  contentTypeOptions: tagOptions.optional(),
  channelOptions: tagOptions.optional(),
}).strict().refine((project) => !project.fields || new Set(project.fields.map((entry) => entry.id)).size === project.fields.length, {
  message: 'Custom fields must have unique IDs', path: ['fields'],
});
export const memberSchema = z.object({ email, role: z.enum(['editor', 'viewer']) }).strict();
export const projectTagSchema = z.object({ kind: z.enum(['contentType', 'channel']), value: tag }).strict();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a valid date in YYYY-MM-DD format');
const link = z.object({
  label: z.string().trim().min(1).max(100).default('Attachment'),
  url: z.string().url().max(2048).refine((value) => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); }
    catch { return false; }
  }, 'Only HTTP or HTTPS links are supported'),
}).strict();
const subtask = z.object({
  id: id.optional(),
  title: z.string().trim().min(1).max(300),
  done: z.boolean().default(false),
}).strict();
const taskShape = {
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10000),
  status: z.enum(['todo', 'in_progress', 'review', 'scheduled', 'done']),
  priority: z.enum(['urgent', 'high', 'normal', 'low']),
  dueDate: date.nullable(),
  assigneeIds: z.array(id).max(50),
  contentTypes: z.array(tag).max(20),
  channels: z.array(tag).max(20),
  links: z.array(link).max(30),
  subtasks: z.array(subtask).max(100),
  customFields: z.record(z.string().max(100), z.string().max(2000)),
};
export const taskSchema = z.object({
  ...taskShape,
  description: taskShape.description.default(''),
  status: taskShape.status.default('todo'),
  priority: taskShape.priority.default('normal'),
  dueDate: taskShape.dueDate.default(null),
  assigneeIds: taskShape.assigneeIds.default([]),
  contentTypes: taskShape.contentTypes.default([]),
  channels: taskShape.channels.default([]),
  links: taskShape.links.default([]),
  subtasks: taskShape.subtasks.default([]),
  customFields: taskShape.customFields.default({}),
}).strict();
export const taskPatchSchema = z.object({
  ...taskShape,
  expectedUpdatedAt: z.string().datetime().optional(),
}).partial().strict();
