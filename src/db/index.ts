import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import * as dotenv from 'dotenv';

dotenv.config();

const client = postgres(process.env.DATABASE_URL!, {
  ssl: { rejectUnauthorized: false },
});
export const db = drizzle(client, { schema });
