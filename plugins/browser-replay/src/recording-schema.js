import { z } from 'zod';

const id = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const selector = z.string().min(1).max(16384);
const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(200);
const common = {page:id,id:id.optional(),time:z.number().finite().optional(),frames:z.array(selector).max(30).optional()};
const event = (type,fields = {}) => z.object({...common,type:z.literal(type),...fields}).strict();
const location = {url:z.string().url().max(65536),urlSecrets:z.array(z.object({key:z.string(),env:envName}).strict()).max(100).optional()};
const recordingSchema = z.object({
  version:z.literal(1),
  events:z.array(z.discriminatedUnion('type',[
    event('page'),event('popup',{opener:id,trigger:id}),
    event('goto',location),event('navigation',location),
    event('click',{selector,button:z.enum(['left','middle','right'])}),
    event('fill',{selector,value:z.string().max(1_000_000).optional(),env:envName.optional()}),
    event('select',{selector,values:z.array(z.string()).max(10000)}),
    event('check',{selector,checked:z.boolean()}),
    event('press',{selector,key:z.string().max(100)}),
    event('scroll',{selector,x:z.number().finite(),y:z.number().finite()}),
    event('assert',{selector,text:z.string().max(1_000_000)}),event('close'),
    event('unsupported',{page:id.optional(),reason:z.string()})
  ])).max(2000),
  requiredEnv:z.array(envName).max(2000).default([]),
  errors:z.array(z.string()).max(2000).default([])
}).strict();

export function parseRecording(input) {
  const parsed = recordingSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Do not echo potentially sensitive input values in diagnostics.
    throw new Error(`Invalid recording at ${issue.path.join('.') || 'root'}: ${issue.code}`);
  }
  const recording = parsed.data;
  const pages = new Set(), events = new Map();
  const declaredEnv = new Set(recording.requiredEnv);
  for (const e of recording.events) {
    if (e.id !== undefined && events.has(e.id)) throw new Error('Invalid recording: duplicate event ID');
    if (e.type === 'page' || e.type === 'popup') {
      if (pages.has(e.page)) throw new Error('Invalid recording: duplicate page ID');
      if (e.type === 'popup') {
        const trigger = events.get(e.trigger);
        if (!pages.has(e.opener) || !trigger || trigger.page !== e.opener || !['click','press'].includes(trigger.type)) throw new Error('Invalid recording: popup has no preceding opener action');
      }
      pages.add(e.page);
    } else if (e.type !== 'unsupported' && !pages.has(e.page)) throw new Error('Invalid recording: action references an unopened or closed page');
    if (e.type === 'fill' && (typeof e.value === 'string') === (typeof e.env === 'string')) throw new Error('Invalid recording: fill requires exactly one value or secret variable');
    for (const name of [e.env,...(e.urlSecrets || []).map(item => item.env)].filter(Boolean)) {
      if (!declaredEnv.has(name)) throw new Error('Invalid recording: undeclared secret variable');
    }
    if (e.type === 'close') pages.delete(e.page);
    if (e.id !== undefined) events.set(e.id,e);
  }
  return recording;
}
