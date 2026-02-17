
const http = require('http');

const startPort = 9000;
const endPort = 9030;

function getPages(port) {
    return new Promise((resolve, reject) => {
        const req = http.get({ hostname: '127.0.0.1', port, path: '/json/list', timeout: 1000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const pages = JSON.parse(data);
                    resolve(pages);
                } catch (e) { resolve([]); }
            });
        });
        req.on('error', () => resolve([]));
        req.on('timeout', () => { req.destroy(); resolve([]); });
    });
}

async function scan() {
    console.log('Scanning ports ' + startPort + ' to ' + endPort + '...');
    const instances = [];
    for (let port = startPort; port <= endPort; port++) {
        const pages = await getPages(port);
        if (pages.length > 0) {
            console.log(`Found active CDP on port ${port}:`);
            pages.forEach(p => {
                console.log(`  - [${p.type}] ${p.title} (${p.url})`);
                console.log(`    WebSocket: ${p.webSocketDebuggerUrl}`);
            });
            instances.push({ port, pages });
        }
    }

    if (instances.length === 0) {
        console.log('No CDP instances found. Is the browser/VS Code launched with remote debugging enabled?');
    }
}

scan();
