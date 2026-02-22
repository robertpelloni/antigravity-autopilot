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

                // Inject the listener
                ws.send(JSON.stringify({
                    id: 2,
                    method: 'Runtime.evaluate',
                    params: {
                        expression: `
                            if (!window.__clickTrap) {
                                window.__clickTrap = true;
                                document.addEventListener('click', (e) => {
                                    if (!e.isTrusted) { // Non-trusted (automation) clicks
                                        const el = e.target;
                                        const tag = el.tagName;
                                        const classes = el.className || '';
                                        const lbl = el.getAttribute('aria-label') || el.title || '';
                                        let html = el.outerHTML;
                                        if (html && html.length > 250) html = html.substring(0, 250) + '...';
                                        console.error('ROGUE_CLICK_DETECTED: ' + tag + ' ' + classes + ' lbl=' + lbl + ' html=' + html);
                                    }
                                }, true);
                            }
                            'Spy installed.'
                        `
                    }
                }));

                // Auto-trigger a sweep to find "Layout" buttons
                ws.send(JSON.stringify({
                    id: 3,
                    method: 'Runtime.evaluate',
                    params: {
                        expression: `
                            (() => {
                                const elements = Array.from(document.querySelectorAll('.action-item, button, a, span, .codicon'));
                                const layoutButtons = elements.filter(el => {
                                    const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).toLowerCase();
                                    return text.includes('customize layout') || text.includes('layout control');
                                });
                                return layoutButtons.map(el => el.outerHTML.substring(0, 150));
                            })();
                        `,
                        returnByValue: true
                    }
                }));
            });

            ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
                    const arg = msg.params.args[0]?.value;
                    if (arg && typeof arg === 'string' && arg.includes('ROGUE_CLICK_DETECTED')) {
                        console.log('>>> [CLICK TRAP]', arg);
                    }
                }
                if (msg.id === 3 && msg.result?.result?.value) {
                    console.log('--- FOUND LAYOUT BUTTONS IN DOM ---');
                    console.log(msg.result.result.value);
                }
            });

            setTimeout(() => {
                console.log('Disconnecting spy.');
                ws.close();
                process.exit(0);
            }, 10000);

        } catch (e) {
            console.error(e);
        }
    });
});
