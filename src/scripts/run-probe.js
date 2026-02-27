const CDP = require('chrome-remote-interface');
const fs = require('fs');

async function run() {
    let client;
    try {
        const script = fs.readFileSync('C:/Users/hyper/workspace/antigravity-autopilot/src/scripts/probe-textareas.js', 'utf8');
        // connect to endpoint
        client = await CDP({ port: 9222 });

        // extract domains
        const { Runtime } = client;

        // evaluate the script text
        const result = await Runtime.evaluate({
            expression: `(function(){ ${script} ; return JSON.stringify(out, null, 2); })()`,
            returnByValue: true
        });

        console.log(result.result.value);
    } catch (err) {
        console.error(err);
    } finally {
        if (client) {
            await client.close();
        }
    }
}

run();
