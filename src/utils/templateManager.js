import { fillTemplate } from "./templateEngine.js";
import { formatAsComment } from "./languageUtils.js";

/**
 * TemplateManager - Handles different types of templates for CodeBridge
 */
export const TemplateManager = {
    /**
     * Build the README content using the markdown template
     */
    buildReadme(data, template, options = {}) {
        const includeProblemStatement = options.includeProblemStatement !== false;
        if (!template) {
            // Default README fallback if no template provided
            const timeLine = data.solveTime ? `\n**Time:** ${data.solveTime}` : "";
            const attemptsLine =
                typeof data.attemptCount === "number"
                    ? `\n**Attempts:** ${data.attemptCount}`
                    : "";
            const desc = includeProblemStatement ? (data.description || data.contentHtml || "") : "";
            const problemSection = desc ? `\n\n## Problem\n\n${desc}` : "";
            const note = data.note ? `\n\n## Note\n\n${data.note}` : "";
            return `# ${data.title}\n\n**Difficulty:** ${data.difficulty}${timeLine}${attemptsLine}\n\n**URL:** ${data.url}${problemSection}${note}`;
        }
        const filled = fillTemplate(template, data);
        let result = filled;
        if (data.solveTime && !template.includes("[time]")) {
            result = `${result}\n\n**Time:** ${data.solveTime}`;
        }
        if (
            typeof data.attemptCount === "number" &&
            !template.includes("[attempts]")
        ) {
            result = `${result}\n\n**Attempts:** ${data.attemptCount}`;
        }
        if (includeProblemStatement && data.description && !template.includes("[description]")) {
            result = `${result}\n\n## Problem\n\n${data.description}`;
        }
        if (data.note && !template.includes("[note]")) {
            result = `${result}\n\n## Note\n\n${data.note}`;
        }
        return result;
    },

    /**
     * Build the solution file header (comments)
     */
    buildSolutionHeader(data, template, extension) {
        if (!template) return "";

        let filled = fillTemplate(template, data);
        if (data.solveTime && !template.includes("[time]")) {
            filled = `${filled}\nTime: ${data.solveTime}`;
        }
        if (
            typeof data.attemptCount === "number" &&
            !template.includes("[attempts]")
        ) {
            filled = `${filled}\nAttempts: ${data.attemptCount}`;
        }
        return formatAsComment(filled, extension);
    },

    /**
     * Populate all templates for a problem
     */
    populateAll(data, templates, extension) {
        return {
            readme: this.buildReadme(data, templates.readme),
            header: this.buildSolutionHeader(data, templates.solutionHeader, extension),
            commit: fillTemplate(templates.commit || "Solved [id] - [title]", data),
            path: fillTemplate(templates.path || "[id]-[slug]/solution.[ext]", { ...data, extension })
        };
    }
};
