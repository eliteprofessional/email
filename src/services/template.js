/**
 * Fast interpolation of {{key}} in strings using provided variables object.
 * If variable is undefined or null, fallback or blank string is used.
 *
 * @param {string} str - Template string containing {{variables}}
 * @param {object} variables - Key-value pairs for replacement
 * @returns {string} - Interpolated string
 */
function renderTemplate(str, variables = {}) {
    if (!str || typeof str !== "string") return str || "";
    if (!variables || typeof variables !== "object") return str;

    return str.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
        const val = variables[key];
        return val !== undefined && val !== null ? String(val) : "";
    });
}

module.exports = {
    renderTemplate
};
