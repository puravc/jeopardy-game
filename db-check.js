const { MongoClient } = require('mongodb');
require('dotenv').config();

async function check() {
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db('jeopardy');
        const gid = 'd3acb1b0-d710-4b5b-bc54-3079a1b263be';
        const game = await db.collection('games').findOne({ id: gid });
        if (!game) {
            console.log('Game not found:', gid);
            return;
        }
        console.log(`Game: ${game.name}`);
        console.log('Players:');
        game.players.forEach(p => {
            console.log(`- ${p.name}: ${p.score}`);
        });
        const answeredQ = game.categories.flatMap(c => c.questions).filter(q => q.answered || q.wrongAnswers?.length > 0);
        console.log('Recent Question Meta:');
        answeredQ.forEach(q => {
            console.log(`- Q: ${q.question.substring(0,20)}... Val: ${q.value} Ans: ${q.answered} WrongAns: ${JSON.stringify(q.wrongAnswers)}`);
        });
    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}
check();
