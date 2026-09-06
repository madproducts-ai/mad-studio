import { z } from 'zod';
import { MadNodeSchema, NodeIdSchema, StylePropsSchema, PropValueSchema, DesignSystemSchema } from './document';

/**
 * Generation lifecycle.
 *
 *   POST /v1/generations            -> GenerationCreated { id, streamUrl }
 *   GET  /v1/generations/:id/events -> text/event-stream of GenerationEvent
 *
 * Every event carries a monotonically increasing `seq` so a client that
 * reconnects can resume with Last-Event-ID and never double-apply a patch.
 */

export const GenerationStatusSchema = z.enum(['queued', 'planning', 'generating', 'wiring', 'complete', 'failed', 'cancelled']);
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

export const PlanStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(120),
  detail: z.string().max(240).optional(),
  status: z.enum(['pending', 'active', 'done', 'skipped']),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

const base = { seq: z.number().int().nonnegative(), at: z.string().datetime() };

export const GenerationEventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('status'), status: GenerationStatusSchema, message: z.string().max(240) }),
  z.object({ ...base, type: z.literal('plan'), steps: z.array(PlanStepSchema).min(1) }),
  z.object({ ...base, type: z.literal('step'), stepId: z.string(), status: PlanStepSchema.shape.status }),
  z.object({
    ...base,
    type: z.literal('node.add'),
    parentId: NodeIdSchema.nullable(),
    index: z.number().int().nonnegative(),
    node: MadNodeSchema,
  }),
  z.object({
    ...base,
    type: z.literal('node.patch'),
    nodeId: NodeIdSchema,
    props: z.record(z.string(), PropValueSchema).optional(),
    style: StylePropsSchema.partial().optional(),
    name: z.string().min(1).max(80).optional(),
  }),
  z.object({ ...base, type: z.literal('node.remove'), nodeId: NodeIdSchema }),
  z.object({ ...base, type: z.literal('integration.add'), slug: z.string(), label: z.string(), scopes: z.array(z.string()) }),
  z.object({ ...base, type: z.literal('schema.table'), table: z.string(), columns: z.array(z.string()).min(1) }),
  z.object({ ...base, type: z.literal('log'), level: z.enum(['info', 'warn', 'error']), message: z.string().max(400) }),
  z.object({ ...base, type: z.literal('tokens'), input: z.number().int(), output: z.number().int() }),
  z.object({ ...base, type: z.literal('done'), durationMs: z.number().int().nonnegative(), nodeCount: z.number().int().nonnegative() }),
  z.object({ ...base, type: z.literal('error'), code: z.string(), message: z.string().max(400), retryable: z.boolean() }),
]);
export type GenerationEvent = z.infer<typeof GenerationEventSchema>;
export type GenerationEventType = GenerationEvent['type'];

/** Omit that distributes over a union, so each event variant keeps its own fields. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A GenerationEvent before the stream assigns `seq` and `at`. */
export type GenerationEventBody = DistributiveOmit<GenerationEvent, 'seq' | 'at'>;

export const CreateGenerationRequestSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    prompt: z.string().trim().min(4, 'Describe the app in at least a few words.').max(2000),
    designSystem: DesignSystemSchema.default('tailwind'),
    seed: z.number().int().optional(),
  })
  .strict();
export type CreateGenerationRequest = z.infer<typeof CreateGenerationRequestSchema>;

export const GenerationCreatedSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: GenerationStatusSchema,
  streamUrl: z.string(),
  createdAt: z.string().datetime(),
});
export type GenerationCreated = z.infer<typeof GenerationCreatedSchema>;

export const GenerationSummarySchema = GenerationCreatedSchema.extend({
  prompt: z.string(),
  durationMs: z.number().int().nullable(),
  nodeCount: z.number().int().nullable(),
  completedAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
});
export type GenerationSummary = z.infer<typeof GenerationSummarySchema>;
