import { fillTemplate } from "./templateEngine.js";
import { formatAsComment } from "./languageUtils.js";

/**
 * TemplateManager - Handles different types of templates for CodeBridge
 */
export const TemplateManager = {
    /**
     * Build the README content using the markdown template
     */
    buildReadme(data, template) {
        if (!template) {
            // Default README fallback if no template provided
            return `# ${data.title}\n\n**Difficulty:** ${data.difficulty}\n\n**URL:** ${data.url}\n\n## Problem\n\n${data.description || data.contentHtml || ""}`;
        }
        return fillTemplate(template, data);
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
