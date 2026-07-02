import '@dotenvx/dotenvx/config';
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../prisma/generated/client";

const connectionString = process.env.DATABASE_URL;

const connectionOpt = { connectionString };
if(connectionString && connectionString.includes('sslmode')){
  connectionOpt.ssl = { rejectUnauthorized: false }
}

const adapter = new PrismaPg(connectionOpt);
export const prisma = new PrismaClient({ adapter });
