import { getDb } from "../src/db";
getDb().then(() => { console.log("migrations applied"); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
