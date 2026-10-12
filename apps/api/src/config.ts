import { z } from 'zod';

const esquema = z.object({
  DATABASE_URL: z.string().min(10),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url(),
  COOKIE_DOMAIN: z.string().optional(),
  NODE_ENV: z.enum(['development','production','test']).default('development'),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  META_ACCESS_TOKEN: z.string().optional(),
  META_WABA_ID: z.string().optional(),
  META_PHONE_NUMBER_ID: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v25.0'),
  META_NUMERO_OFICIAL: z.string().optional(),
});
export const config = esquema.parse(process.env);
export const metaConfigurado = Boolean(config.META_APP_SECRET && config.META_VERIFY_TOKEN && config.META_ACCESS_TOKEN && config.META_PHONE_NUMBER_ID);
