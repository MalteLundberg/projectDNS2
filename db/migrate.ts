import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "../lib/database.js";

async function main() {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  await getPool().end();
}

main().catch(async (error) => {
  console.error(error);
  await getPool().end();
  process.exit(1);
});
