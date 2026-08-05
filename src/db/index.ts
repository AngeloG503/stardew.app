import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { createPool, type Pool } from "mysql2/promise";
import * as schema from "./schema";

export type Db = MySql2Database<typeof schema>;

declare global {
	// eslint-disable-next-line no-var
	var __dbPool: Pool | undefined;
}

function getPool(): Pool {
	if (!global.__dbPool) {
		const url = new URL(process.env.DATABASE_URL!);
		global.__dbPool = createPool({
			host: url.hostname,
			port: Number(url.port),
			user: decodeURIComponent(url.username),
			password: decodeURIComponent(url.password),
			database: url.pathname.slice(1),
			connectionLimit: 10,
			waitForConnections: true,
		});
	}
	return global.__dbPool;
}

let dbInstance: Db | undefined;
export function getDb(): Db {
	if (!dbInstance) {
		dbInstance = drizzle(getPool(), { schema, mode: "default" });
	}
	return dbInstance;
}

export async function withDb<T>(callback: (db: Db) => Promise<T>): Promise<T> {
	return callback(getDb());
}