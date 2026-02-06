// leetcode/extractor.js — Code extraction from Monaco/CodeMirror editors
// Background script executes this in the page's MAIN world to access editor instances

import { log } from "../core/logger.js";

/**
 * The function that runs in the page's MAIN world to extract code
 * This is injected via chrome.scripting.executeScript
 */
function extractCodeFromPage() {
    try {
        // 1) If monaco.editor.getEditors exists, prefer editable editor instances
        if (window.monaco && window.monaco.editor) {
            try {
                const editors =
                    (monaco.editor.getEditors && monaco.editor.getEditors()) || [];

                if (editors && editors.length) {
                    // Pick editable editor with longest content
                    let best = null;
                    for (const ed of editors) {
                        try {
                            const val =
                                (ed.getValue && ed.getValue()) ||
                                (ed.getModel && ed.getModel().getValue && ed.getModel().getValue()) ||
                                "";
                            if (!best || (val && val.length > (best.valLength || 0))) {
                                best = { ed, val, valLength: val ? val.length : 0 };
                            }
                        } catch (e) {
                            /* ignore per-editor errors */
                        }
                    }

                    if (best && best.val) {
                        const model = (best.ed.getModel && best.ed.getModel()) || null;
                        const lang =
                            model && model.getLanguageIdentifier && model.getLanguageIdentifier().language
                                ? model.getLanguageIdentifier().language
                                : (model && model.getModeId ? model.getModeId() : null);
                        return { code: best.val, languageId: lang || null };
                    }
                }
            } catch (e) {
                /* ignore editors API errors */
            }

            // 2) Fallback: use monaco models (choose longest)
            try {
                const models = (monaco.editor.getModels && monaco.editor.getModels()) || [];

                if (models && models.length) {
                    let bestModel = models[0];
                    for (const m of models) {
                        try {
                            const aLen = (bestModel.getValue && bestModel.getValue().length) || 0;
                            const bLen = (m.getValue && m.getValue().length) || 0;
                            if (bLen > aLen) bestModel = m;
                        } catch (e) {
                            /* ignore */
                        }
                    }
                    return {
                        code: (bestModel.getValue && bestModel.getValue()) || "",
                        languageId:
                            (bestModel.getLanguageIdentifier && bestModel.getLanguageIdentifier().language) ||
                            (bestModel.getModeId ? bestModel.getModeId() : null),
                    };
                }
            } catch (e) {
                /* ignore models errors */
            }
        }

        // 3) window.editor fallback
        if (window.editor && typeof window.editor.getValue === "function") {
            return { code: window.editor.getValue(), languageId: null };
        }

        // 4) CodeMirror fallback
        const cmEl = document.querySelector(".CodeMirror");
        if (cmEl && cmEl.CodeMirror && typeof cmEl.CodeMirror.getValue === "function") {
            return {
                code: cmEl.CodeMirror.getValue(),
                languageId: cmEl.CodeMirror.getOption ? cmEl.CodeMirror.getOption("mode") : null,
            };
        }

        // 5) Ace Editor fallback
        try {
            const aceEl = document.querySelector(".ace_editor");
            if (aceEl && window.ace) {
                const editor = ace.edit(aceEl);
                if (editor && typeof editor.getValue === "function") {
                    return { code: editor.getValue(), languageId: null };
                }
            }
        } catch (e) { }

        // 6) Generic Textarea fallback (longest)
        try {
            const textareas = Array.from(document.querySelectorAll("textarea"));
            if (textareas.length) {
                let best = textareas[0];
                for (const t of textareas) {
                    if (t.value.length > best.value.length) best = t;
                }
                if (best.value.length > 50) { // arbitrary threshold to avoid search boxes
                    return { code: best.value, languageId: null };
                }
            }
        } catch (e) { }

        // 7) DOM reconstruction fallback (monaco view-line)
        try {
            const viewLines = Array.from(document.querySelectorAll(".monaco-editor .view-line"));
            if (viewLines && viewLines.length) {
                const domCode = viewLines.map((l) => l.textContent || "").join("\n");
                if (domCode && domCode.length) {
                    return { code: domCode, languageId: null };
                }
            }
        } catch (e) {
            /* ignore */
        }

        return { code: "", languageId: null };
    } catch (e) {
        return { code: "", languageId: null };
    }
}

/**
 * Execute code extraction in a tab
 * @param {number} tabId - The tab ID to extract from
 * @param {Function} sendResponse - Callback to send response
 */
export function executeCodeExtraction(tabId, sendResponse) {
    chrome.scripting.executeScript(
        {
            target: { tabId },
            world: "MAIN",
            func: extractCodeFromPage,
        },
        (results) => {
            if (chrome.runtime.lastError || !results || !results.length) {
                sendResponse({
                    success: false,
                    message: chrome.runtime.lastError
                        ? chrome.runtime.lastError.message
                        : "No result from page",
                });
                return;
            }
            sendResponse({ success: true, data: results[0].result });
        }
    );
}
