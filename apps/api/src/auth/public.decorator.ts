import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'mad:isPublic';

/** Marks a route as reachable without a session (health, catalog reads). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
