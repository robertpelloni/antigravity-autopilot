// Probing for webviews or iframes
const frames = document.querySelectorAll('webview, iframe');
let out = [];
frames.forEach(t => {
    let p = t;
    let path = [];
    while (p && p.tagName) {
        path.push(`${p.tagName.toLowerCase()}${p.id ? '#' + p.id : ''}${p.className ? '.' + p.className.replace(/\s+/g, '.') : ''}`);
        p = p.parentElement;
    }
    out.push({
        tag: t.tagName,
        src: t.src || t.getAttribute('src'),
        vis: t.offsetParent !== null,
        dims: `${t.clientWidth}x${t.clientHeight}`,
        path: path.reverse().join(' > ')
    });
});
console.log(JSON.stringify(out, null, 2));
