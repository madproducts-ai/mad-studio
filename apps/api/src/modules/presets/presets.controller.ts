import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { PRESETS, PRESET_CATEGORIES, presetsFor } from '@mad/planner';
import { DesignSystemSchema, type ComponentPreset } from '@mad/schema';
import { zodBody } from '../../common/zod-validation.pipe';

const QuerySchema = z.object({ designSystem: DesignSystemSchema.optional(), q: z.string().trim().max(60).optional() });

@Controller('presets')
export class PresetsController {
  @Get()
  list(@Query(zodBody(QuerySchema)) query: z.infer<typeof QuerySchema>): { categories: typeof PRESET_CATEGORIES; items: ComponentPreset[] } {
    const base = query.designSystem ? presetsFor(query.designSystem) : [...PRESETS];
    const q = query.q?.toLowerCase();
    const items = q ? base.filter((p) => p.name.toLowerCase().includes(q) || p.keywords.some((k) => k.includes(q)) || p.description.toLowerCase().includes(q)) : base;
    return { categories: PRESET_CATEGORIES, items };
  }
}
