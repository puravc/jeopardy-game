const { WebSocket } = require('ws');

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const wsUrl = baseUrl.replace(/^http/, 'ws');

function fail(message) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
}

function pass(message) {
    console.log(`PASS: ${message}`);
}

async function expectStatus(path, method, expectedStatus) {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
    });

    if (res.status !== expectedStatus) {
        let body = '';
        try {
            body = await res.text();
        } catch (e) {
            body = '';
        }
        fail(`${method} ${path} expected ${expectedStatus}, got ${res.status}. Body: ${body}`);
    }

    pass(`${method} ${path} -> ${expectedStatus}`);
}

async function expectWsHostJoinRejected() {
    await new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
            ws.terminate();
            reject(new Error('Timeout waiting for websocket response'));
        }, 5000);

        ws.on('open', () => {
            ws.send(JSON.stringify({ type: 'host_join', gameId: 'nonexistent-game-id' }));
        });

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'error' && /Host authentication is required/i.test(msg.message || '')) {
                    clearTimeout(timeout);
                    ws.close();
                    pass('WS host_join without session cookie is rejected');
                    resolve();
                    return;
                }
                clearTimeout(timeout);
                ws.close();
                reject(new Error(`Unexpected WS message: ${raw.toString()}`));
            } catch (err) {
                clearTimeout(timeout);
                ws.close();
                reject(err);
            }
        });

        ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

async function main() {
    await expectStatus('/api/auth/session', 'GET', 401);
    await expectStatus('/api/auth/logout', 'POST', 403);
    await expectStatus('/api/games', 'POST', 403);
    await expectWsHostJoinRejected();
    console.log('Security smoke checks completed.');
}

main().catch((err) => fail(err.message));
