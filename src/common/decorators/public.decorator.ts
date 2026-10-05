import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'trackit:isPublic';

/** Opts a route out of the globally applied JwtAuthGuard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
