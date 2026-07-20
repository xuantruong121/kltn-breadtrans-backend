"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    await prisma.practiceTopic.deleteMany({});
    console.log('Deleted all topics');
}
main().catch(console.error).finally(() => prisma.$disconnect());
//# sourceMappingURL=clear.js.map