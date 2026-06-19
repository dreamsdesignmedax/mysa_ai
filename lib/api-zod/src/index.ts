import { z } from 'zod';

// Common schemas
export const StringSchema = z.string();
export const NumberSchema = z.number();
export const BooleanSchema = z.boolean();
export const DateSchema = z.coerce.date();

// Export Zod for convenience
export { z };
