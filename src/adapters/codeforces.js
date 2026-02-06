export const CodeforcesAdapter = {
    name: "Codeforces",
    matches: () => location.hostname.includes("codeforces.com"),

    // Attempt to finding the "Accepted" submission URL
    getSubmissionUrl() {
        console.log("[CodeBridge] Scanning for submission URL...");

        // Strategy A: Sidebar "Last submissions" (most reliable on problem page)
        // We look for row with class "verdict-accepted" or text "Accepted"

        const sideTables = Array.from(document.querySelectorAll('.sidebar .rtable, .sidebar table'));
        console.log(`[CodeBridge] Found ${sideTables.length} tables in sidebar`);

        for (const table of sideTables) {
            const rows = Array.from(table.rows);
            // Look for row with accepted verdict
            const acceptedRow = rows.find(r =>
                r.querySelector('.verdict-accepted') ||
                r.innerText.includes('Accepted')
            );

            if (acceptedRow) {
                console.log("[CodeBridge] Found Accepted row in sidebar");
                // Determine which link is the submission ID
                // Usually the first link or a link with "submission" in href
                const links = Array.from(acceptedRow.querySelectorAll('a'));
                const subLink = links.find(a => a.href.includes('/submission/'));
                if (subLink) {
                    // Handle relative or absolute URLs robustly
                    const finalUrl = new URL(subLink.getAttribute('href'), location.origin).href;
                    console.log("[CodeBridge] Detected submission URL:", finalUrl);
                    return finalUrl;
                }
            }
        }

        // Strategy B: Main Status Table (if user is on status page)
        const mainRows = Array.from(document.querySelectorAll('table.status-frame-datatable tr, table.rtable tr'));
        const acceptedMain = mainRows.find(r =>
            r.querySelector('.verdict-accepted') ||
            r.innerText.includes('Accepted')
        );
        if (acceptedMain) {
            console.log("[CodeBridge] Found Accepted row in main table");
            const link = acceptedMain.querySelector('a[href*="/submission/"]');
            if (link) {
                const finalUrl = new URL(link.getAttribute('href'), location.origin).href;
                console.log("[CodeBridge] Detected submission URL (Main):", finalUrl);
                return finalUrl;
            }
        }

        console.warn("[CodeBridge] No Accepted submission link found on page");
        return null;
    },

    async gather() {
        // --- 1. Title & Metadata ---
        const titleEl = document.querySelector('.problem-statement .header .title');
        let rawTitle = titleEl ? titleEl.innerText.trim() : document.title;

        let id = "0";
        let title = rawTitle;

        // Parsing "A. Problem Name"
        const idMatch = rawTitle.match(/^([A-Z0-9]+)\.\s+(.*)/);
        if (idMatch) {
            id = idMatch[1];
            title = idMatch[2];
        } else {
            // Fallback from breadcrumbs or specific links
            const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumb li a, .rtable tr td a[href*="/problem/"], a[href*="/problem/"]'));
            const probLink = breadcrumbs.find(a => /\/problem\/[A-Z0-9]+$/.test(a.href));
            if (probLink) {
                title = probLink.innerText.trim();
                const pathParts = new URL(probLink.href).pathname.split('/').filter(Boolean);
                id = pathParts[pathParts.length - 1] || "0";
            }
        }

        // Clean up title (remove "Submission XXX for ...")
        title = title.replace(/^Submission\s+[0-9]+\s+for\s+/i, "");

        // --- 2. Difficulty & Tags ---
        const tags = Array.from(document.querySelectorAll('.tag-box')).map(el => el.innerText.trim());
        const diffTag = tags.find(t => t.startsWith('*'));
        const difficulty = diffTag ? diffTag.replace('*', '') : "Unknown";

        // --- 3. Language ---
        const langSelect = document.querySelector('select[name="programTypeId"]');
        let language = langSelect ? langSelect.options[langSelect.selectedIndex].text.trim() : "";

        // --- 4. Content ---
        const contentEl = document.querySelector('.problem-statement');
        let contentHtml = "";
        if (contentEl) {
            // Clone to avoid modifying the live page
            const clone = contentEl.cloneNode(true);
            // Remove the header (Title/Time/Memory limits) to leave only the problem body if desired
            // or keep it for completeness? Users usually like the full statement.
            // Let's keep it but remove potentially broken things.
            contentHtml = clone.innerHTML;
        }

        return {
            platform: "Codeforces",
            slug: id,
            id,
            title,
            difficulty,
            tags: tags.filter(t => !t.startsWith('*')),
            contentHtml,
            language,
            folderName: ""
        };
    }
};
