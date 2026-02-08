// Defines comment syntaxes for supported languages
// Used to embed problem descriptions into solution files

const COMMENT_CONFIG = {
    // C-style (Block: /* ... */)
    c: { blockStart: "/*", blockEnd: "*/", line: "//" },
    cpp: { blockStart: "/*", blockEnd: "*/", line: "//" },
    cs: { blockStart: "/*", blockEnd: "*/", line: "//" },
    java: { blockStart: "/*", blockEnd: "*/", line: "//" },
    js: { blockStart: "/*", blockEnd: "*/", line: "//" },
    ts: { blockStart: "/*", blockEnd: "*/", line: "//" },
    kt: { blockStart: "/*", blockEnd: "*/", line: "//" },
    swift: { blockStart: "/*", blockEnd: "*/", line: "//" },
    go: { blockStart: "/*", blockEnd: "*/", line: "//" },
    rs: { blockStart: "/*", blockEnd: "*/", line: "//" },
    scala: { blockStart: "/*", blockEnd: "*/", line: "//" },
    php: { blockStart: "/*", blockEnd: "*/", line: "//" },
    css: { blockStart: "/*", blockEnd: "*/" },

    // Python (Docstring: """ ... """)
    py: { blockStart: '"""', blockEnd: '"""', line: "#" },

    // Ruby (Block: =begin ... =end) - strict placement, maybe safer to use line comments
    rb: { blockStart: "=begin", blockEnd: "=end", line: "#" },

    // SQL (Block: /* ... */)
    sql: { blockStart: "/*", blockEnd: "*/", line: "--" },

    // HTML/XML
    html: { blockStart: "<!--", blockEnd: "-->" },
    xml: { blockStart: "<!--", blockEnd: "-->" },

    // Scripts (Line only usually, but we simulate block)
    sh: { line: "#" },
    pl: { line: "#" },
    yaml: { line: "#" },

    // Default fallback
    txt: { line: "" }
};

// Aliases
const EXT_ALIAS = {
    python: 'py',
    python3: 'py',
    javascript: 'js',
    typescript: 'ts',
    csharp: 'cs',
    kotlin: 'kt',
    rust: 'rs',
    ruby: 'rb',
    golang: 'go'
};

/**
 * Get comment syntax for a given extension
 * @param {string} ext - file extension (e.g. "py", "js")
 */
export function getCommentSyntax(ext) {
    const norm = ext.replace(/^\./, "").toLowerCase();
    const type = EXT_ALIAS[norm] || norm;
    return COMMENT_CONFIG[type] || COMMENT_CONFIG.txt;
}

/**
 * Wrap text in comments based on extension
 * @param {string} text - content to comment out
 * @param {string} ext - file extension
 */
export function formatAsComment(text, ext) {
    const syntax = getCommentSyntax(ext);

    // If block comments are supported, use them (cleaner for large text)
    if (syntax.blockStart && syntax.blockEnd) {
        // Simple escape check: if content contains blockEnd, fall back to line comments
        if (!text.includes(syntax.blockEnd)) {
            return `${syntax.blockStart}\n${text}\n${syntax.blockEnd}`;
        }
    }

    // Fallback to line comments
    const prefix = syntax.line ? `${syntax.line} ` : "";
    return text.split('\n').map(l => `${prefix}${l}`).join('\n');
}
