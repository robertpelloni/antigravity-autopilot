// Basic script to probe current Cursor DOM when run via developer tools
const contenteditables = document.querySelectorAll('[contenteditable="true"]');
let out = [];
contenteditables.forEach(t => {
    let p = t;
    let path = [];
    while (p && p.tagName) {
        path.push(`${p.tagName.toLowerCase()}${p.id ? '#' + p.id : ''}${p.className ? '.' + p.className.replace(/\s+/g, '.') : ''}`);
        p = p.parentElement;
    }
    out.push({
        val: t.value || t.innerText,
        vis: t.offsetParent !== null,
        path: path.reverse().join(' > ')
    });
});
console.log(JSON.stringify(out, null, 2));
