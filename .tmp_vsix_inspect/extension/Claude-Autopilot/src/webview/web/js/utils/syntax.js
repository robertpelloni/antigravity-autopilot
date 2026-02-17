import { escapeHtml } from './html.js';

export function getLanguageFromExtension(extension) {
    const languageMap = {
        'js': 'javascript',
        'jsx': 'javascript', 
        'ts': 'typescript',
        'tsx': 'typescript',
        'json': 'json',
        'html': 'html',
        'htm': 'html',
        'css': 'css',
        'scss': 'css',
        'sass': 'css',
        'py': 'python',
        'md': 'markdown',
        'txt': 'text',
        'xml': 'xml',
        'yaml': 'yaml',
        'yml': 'yaml'
    };
    return languageMap[extension.toLowerCase()] || 'text';
}

export function applySyntaxHighlightingToText(content, language) {
    // First escape HTML characters to prevent XSS and display issues
    let escapedContent = escapeHtml(content);

    // Basic highlighting for common languages
    if (language === 'javascript' || language === 'typescript') {
        escapedContent = escapedContent
            .replace(/\b(const|let|var|function|class|if|else|return|import|export|from|async|await|for|while|do|break|continue|switch|case|default|try|catch|finally|throw|new|this|super|extends|implements|interface|type|enum|namespace|public|private|protected|static|readonly)\b/g, '<span style="color: #569cd6;">$1</span>')
            .replace(/(&#x27;|&quot;|`)([^&#x27;&quot;`]*?)\1/g, '<span style="color: #ce9178;">$&</span>')
            .replace(/\/\/.*$/gm, '<span style="color: #6a9955;">$&</span>')
            .replace(/\/\*[\s\S]*?\*\//g, '<span style="color: #6a9955;">$&</span>')
            .replace(/\b(\d+\.?\d*)\b/g, '<span style="color: #b5cea8;">$1</span>');
    } else if (language === 'json') {
        escapedContent = escapedContent
            .replace(/(&quot;[^&quot;]*&quot;)(\s*:)/g, '<span style="color: #9cdcfe;">$1</span>$2')
            .replace(/:\s*(&quot;[^&quot;]*&quot;)/g, ': <span style="color: #ce9178;">$1</span>')
            .replace(/:\s*(\d+\.?\d*)/g, ': <span style="color: #b5cea8;">$1</span>')
            .replace(/:\s*(true|false|null)/g, ': <span style="color: #569cd6;">$1</span>');
    } else if (language === 'python') {
        escapedContent = escapedContent
            .replace(/\b(def|class|if|elif|else|for|while|try|except|finally|with|as|import|from|return|yield|break|continue|pass|lambda|and|or|not|is|in|True|False|None)\b/g, '<span style="color: #569cd6;">$1</span>')
            .replace(/(&#x27;|&quot;|&#x60;)([^&#x27;&quot;&#x60;]*?)\1/g, '<span style="color: #ce9178;">$&</span>')
            .replace(/#.*$/gm, '<span style="color: #6a9955;">$&</span>')
            .replace(/@\w+/g, '<span style="color: #dcdcaa;">$&</span>')
            .replace(/\b(\d+\.?\d*)\b/g, '<span style="color: #b5cea8;">$1</span>');
    } else if (language === 'css') {
        escapedContent = escapedContent
            .replace(/([a-zA-Z-]+)(\s*:)/g, '<span style="color: #9cdcfe;">$1</span>$2')
            .replace(/:\s*([^;{}]+)/g, ': <span style="color: #ce9178;">$1</span>')
            .replace(/\/\*[\s\S]*?\*\//g, '<span style="color: #6a9955;">$&</span>');
    } else if (language === 'html') {
        escapedContent = escapedContent
            .replace(/&lt;(\/?[a-zA-Z][^&gt;]*)&gt;/g, '<span style="color: #569cd6;">$&</span>')
            .replace(/(\w+)=(&quot;[^&quot;]*&quot;)/g, '<span style="color: #9cdcfe;">$1</span>=<span style="color: #ce9178;">$2</span>');
    }

    return escapedContent;
}