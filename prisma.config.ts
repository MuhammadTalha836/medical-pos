import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 CLI configuration (the datasource URL moved here from schema.prisma)
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL')
  }
});
