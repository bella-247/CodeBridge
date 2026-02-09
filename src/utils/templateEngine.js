/**
 * Simple template engine to replace placeholders with problem data.
 * Supports: [id], [title], [slug], [difficulty], [language], [ext], [platform], [description], [url], [tags], [folder], [time]
 */
export function fillTemplate(template, data) {
    if (!template) return "";

    let result = template;
    const replacements = {
        '[id]': data.id || 'UnknownID',
        '[title]': data.title || 'UnknownTitle',
        '[slug]': data.slug || data.folderName || 'unknown-slug',
        '[difficulty]': data.difficulty || 'Unknown',
        '[language]': data.language || 'unknown',
        '[ext]': data.extension || 'txt',
        '[platform]': data.platform || 'LeetCode',
        '[description]': data.description || '',
        '[url]': data.url || '',
        '[tags]': Array.isArray(data.tags) ? data.tags.join(', ') : (data.tags || ''),
        '[folder]': data.folderName || '',
        '[time]': data.solveTime || ''
    };

    for (const [key, value] of Object.entries(replacements)) {
        // Use global regex to replace all occurrences
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape for regex
        result = result.replace(new RegExp(escapedKey, 'g'), value);
    }

    return result;
}
