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
                            if (!window.__clickTrap2) {
                                window.__clickTrap2 = true;
                                document.addEventListener('click', (e) => {
                                    if (!e.isTrusted) { // Non-trusted (automation) clicks
                                        const el = e.target;
                                        const tag = el.tagName;
                                        const classes = el.className || '';
                                        const lbl = String(el.getAttribute('aria-label') || el.title || '');
                                        let html = el.outerHTML;
                                        if (html && html.length > 250) html = html.substring(0, 250) + '...';
                                        
                                        const parent = el.parentElement;
                                        const phtml = parent ? (parent.outerHTML && parent.outerHTML.substring(0, 100)) : 'none';
                                        
                                        console.error('ROGUE_CLICK_DETECTED: ' + tag + ' ' + classes + ' lbl=' + lbl + ' | html=' + html + ' | parent=' + phtml);
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
                if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
                    const arg = msg.params.args[0]?.value;
                    if (arg && typeof arg === 'string' && arg.includes('ROGUE_CLICK_DETECTED')) {
                        console.log('>>> [CLICK TRAP]', arg);
                    }
                }
            });

            setTimeout(() => {
                console.log('Disconnecting spy loop 1.');
                ws.close();
                process.exit(0); // Exit after 60 seconds
            }, 60000);
            
        } catch (e) {
            console.error(e);
        }
    });
});
