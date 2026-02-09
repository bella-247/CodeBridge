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
            const desc = includeProblemStatement ? (data.description || data.contentHtml || "") : "";
            const problemSection = desc ? `\n\n## Problem\n\n${desc}` : "";
            return `# ${data.title}\n\n**Difficulty:** ${data.difficulty}${timeLine}\n\n**URL:** ${data.url}${problemSection}`;
        }
        const filled = fillTemplate(template, data);
        let result = filled;
        if (data.solveTime && !template.includes("[time]")) {
            result = `${result}\n\n**Time:** ${data.solveTime}`;
        }
        if (includeProblemStatement && data.description && !template.includes("[description]")) {
            result = `${result}\n\n## Problem\n\n${data.description}`;
        }
        return result;
    },

    /**
     * Build the solution file header (comments)
     */
    buildSolutionHeader(data, template, extension) {
        if (!template) return "";

        const filled = fillTemplate(template, data);
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
