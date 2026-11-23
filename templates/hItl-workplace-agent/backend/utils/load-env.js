import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), override: true });
if (process.env.PUBLIC_BASE_URL) process.env.FRONTEND_PUBLIC_URL = process.env.PUBLIC_BASE_URL;
