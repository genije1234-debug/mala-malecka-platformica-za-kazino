import { initSchema } from "./db.ts";
import { seedDatabase } from "./seedData.ts";

initSchema();
seedDatabase();
console.log("Seed gotov: igre, 10 jackpotova, admin i demo igrac kreirani.");
