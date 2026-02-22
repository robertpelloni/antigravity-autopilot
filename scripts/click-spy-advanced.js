const WebSocket = require('ws');
const http = require('http');

http.get({ hostname: '127.0.0.1', port: 9333, path: '/json/list' }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const pages = JSON.parse(data);
            const page = pages.find(p => p.type === 'page' || p.url.includes('workbench'));
            if (!page) return console.log('No root workbench page found');

            console.log('Attaching to:', page.title);
            const ws = new WebSocket(page.webSocketDebuggerUrl);
            ws.on('open', () => {
                ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));

                // Inject the standard DOM listener again, but this time catch ALL clicks
                ws.send(JSON.stringify({
                    id: 2,
                    method: 'Runtime.evaluate',
                    params: {
                        expression: `
                            if (!window.__clickTrap3) {
                                window.__clickTrap3 = true;
                                document.addEventListener('click', (e) => {
                                    const el = e.target;
                                    const tag = el.tagName;
                                    const classes = el.className || '';
                                    const lbl = String(el.getAttribute('aria-label') || el.title || '');
                                    
                                    // Log ONLY if it touches the layout button OR is automated
                                    if (!e.isTrusted || lbl.toLowerCase().includes('layout') || classes.includes('layout')) {
                                        console.error('TRAP_DOM_CLICK: trusted=' + e.isTrusted + ' tag=' + tag + ' ' + classes + ' lbl=' + lbl);
                                    }
                                }, true);
                                
                                // Also catch mousedown
                                document.addEventListener('mousedown', (e) => {
                                    const el = e.target;
                                    const lbl = String(el.getAttribute('aria-label') || el.title || '').toLowerCase();
                                    if (!e.isTrusted || lbl.includes('layout')) {
                                        console.error('TRAP_MOUSEDOWN: trusted=' + e.isTrusted + ' lbl=' + lbl);
                                    }
                                }, true);
                            }
                            'Spy installed.'
                        `
                    }
                }));

            });

            ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());

                // Track console errors
                if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
                    const arg = msg.params.args[0]?.value;
                    if (arg && typeof arg === 'string' && arg.includes('TRAP_')) {
                        console.log('>>> [OBSERVED]', arg);
                    }
                }
            });

            setTimeout(() => {
                console.log('Disconnecting exhaustive spy.');
                ws.close();
                process.exit(0);
            }, 120000);

        } catch (e) {
            console.error(e);
        }
    });
});
