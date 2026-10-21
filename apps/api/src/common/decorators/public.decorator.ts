import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public';
/** Mark a route as public (skips JwtAuthGuard). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
