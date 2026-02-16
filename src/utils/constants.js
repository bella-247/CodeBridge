/**
 * Common constants for CodeBridge
 */

export const LANGUAGE_EXTENSION_MAP = {
    cpp: ".cpp",
    c: ".c",
    java: ".java",
    python: ".py",
    python3: ".py",
    csharp: ".cs",
    javascript: ".js",
    typescript: ".ts",
    ruby: ".rb",
    swift: ".swift",
    go: ".go",
    kotlin: ".kt",
    rust: ".rs",
    php: ".php",
    scala: ".scala",
    sql: ".sql",
    bash: ".sh",
    dart: ".dart",
    haskell: ".hs",
    lua: ".lua",
    perl: ".pl"
};

export const PLATFORM_NAMES = {
    LEETCODE: "LeetCode",
    CODEFORCES: "Codeforces",
    HACKERRANK: "HackerRank"
};

export const SUPPORTED_PLATFORMS = [
    {
        key: "leetcode",
        name: "LeetCode",
        hostPattern: "leetcode.com",
        adapterModule: "src/content/adapters/leetcodeAdapter.js",
        adapterExport: "LeetCodeSessionAdapter"
    },
    {
        key: "codeforces",
        name: "Codeforces",
        hostPattern: "codeforces.com",
        adapterModule: "src/content/adapters/codeforcesAdapter.js",
        adapterExport: "CodeforcesSessionAdapter"
    },
    {
        key: "hackerrank",
        name: "HackerRank",
        hostPattern: "hackerrank.com",
        adapterModule: "src/content/adapters/hackerrankAdapter.js",
        adapterExport: "HackerRankSessionAdapter"
    }
];
