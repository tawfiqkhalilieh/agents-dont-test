import { z } from 'zod';
const selector = z.string().min(1).max(16384);
export const captureEvent = z.discriminatedUnion('type', [
  z.object({type:z.literal('click'),selector,button:z.enum(['left','middle','right'])}),
  z.object({type:z.literal('fill'),selector,value:z.string().max(1_000_000).optional(),secret:selector.optional()}),
  z.object({type:z.literal('select'),selector,values:z.array(z.string()).max(10000)}),
  z.object({type:z.literal('check'),selector,checked:z.boolean()}),
  z.object({type:z.literal('press'),selector,key:z.string().max(100)}),
  z.object({type:z.literal('scroll'),selector,x:z.number().finite(),y:z.number().finite()}),
  z.object({type:z.literal('unsupported'),reason:z.string().max(1000)})
]).refine(e => e.type !== 'fill' || typeof e.value === 'string' || typeof e.secret === 'string');
