import { drain } from "../src/server/shared/outbox";
drain().then((r) => { console.log(r); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
