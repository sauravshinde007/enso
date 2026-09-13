const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_FILE = path.join(ROOT_DIR, "enso-codebase.txt");

// ============================================================================
// CONFIGURATION
// ============================================================================

const PROJECT_DIRECTORIES = ["client", "server"];

// Directories that should NEVER be scanned
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".github",
  ".idea",
  ".vscode",

  // Build / generated output
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".cache",
  ".vite",
  "out",

  // Dependencies / generated directories
  "vendor",
  "target",

  // Common test output
  "playwright-report",
  "test-results",

  // 3D / asset directories
  "assets",
  "models",
  "textures",
]);

// Files that should NEVER be exported
const IGNORED_FILES = new Set([
  "enso-codebase.txt",

  // Environment files
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  ".env.staging",
  ".env.development.local",
  ".env.production.local",
  ".env.test.local",

  // Credentials / secrets
  "credentials.json",
  "credentials.yml",
  "credentials.yaml",
  "secrets.json",
  "secrets.yml",
  "secrets.yaml",

  // Private keys / certificates
  "private.key",
  "private.pem",
  "server.key",
  "server.pem",
  "id_rsa",
  "id_rsa.pub",
]);

// File-name patterns that should NEVER be exported
const SENSITIVE_FILE_PATTERNS = [
  /^\.env($|\.)/i,
  /credentials/i,
  /^secrets?/i,
  /secret[-_.]/i,
  /private[-_.]?key/i,
  /service[-_.]?account/i,
];

// Source/config files worth giving to an AI
const ALLOWED_EXTENSIONS = new Set([
  // JavaScript / TypeScript
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",

  // Web
  ".html",
  ".css",
  ".scss",
  ".sass",
  ".less",

  // Data / configuration
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".xml",

  // Documentation
  ".md",
  ".mdx",
  ".txt",

  // API / schema
  ".graphql",
  ".gql",

  // Shell
  ".sh",
  ".bash",

  // Prisma / database
  ".prisma",

  // Other common configuration
  ".toml",
  ".ini",
  ".conf",
]);

// Files without extensions that are useful
const ALLOWED_FILENAMES = new Set([
  "Dockerfile",
  "Makefile",
  ".gitignore",
  ".dockerignore",
]);

// Don't include enormous text files
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

// ============================================================================
// STATE
// ============================================================================

const files = [];
const skippedFiles = [];

// ============================================================================
// SECURITY
// ============================================================================

/**
 * Determines whether a filename looks sensitive.
 */
function isSensitiveFile(fileName) {
  // Explicitly block every .env variant
  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return true;
  }

  // Explicit block list
  if (IGNORED_FILES.has(fileName)) {
    return true;
  }

  // Pattern-based protection
  return SENSITIVE_FILE_PATTERNS.some((pattern) =>
    pattern.test(fileName)
  );
}

/**
 * Redacts common secrets accidentally hardcoded into source code.
 *
 * This is an additional safety layer.
 * Environment files are already excluded completely.
 */
function redactSecrets(content) {
  let result = content;

  // --------------------------------------------------------------------------
  // OpenAI-style API keys
  // --------------------------------------------------------------------------

  result = result.replace(
    /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    "[REDACTED_API_KEY]"
  );

  // --------------------------------------------------------------------------
  // GitHub tokens
  // --------------------------------------------------------------------------

  result = result.replace(
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
    "[REDACTED_GITHUB_TOKEN]"
  );

  // --------------------------------------------------------------------------
  // Slack tokens
  // --------------------------------------------------------------------------

  result = result.replace(
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
    "[REDACTED_SLACK_TOKEN]"
  );

  // --------------------------------------------------------------------------
  // AWS Access Keys
  // --------------------------------------------------------------------------

  result = result.replace(
    /\bAKIA[0-9A-Z]{16}\b/g,
    "[REDACTED_AWS_ACCESS_KEY]"
  );

  // --------------------------------------------------------------------------
  // Bearer tokens
  // --------------------------------------------------------------------------

  result = result.replace(
    /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
    "Bearer [REDACTED_TOKEN]"
  );

  // --------------------------------------------------------------------------
  // Authorization headers containing tokens
  // --------------------------------------------------------------------------

  result = result.replace(
    /(Authorization\s*[:=]\s*["'`]?Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
    "$1[REDACTED_TOKEN]"
  );

  // --------------------------------------------------------------------------
  // Private keys
  // --------------------------------------------------------------------------

  result = result.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    "[REDACTED_PRIVATE_KEY]"
  );

  // --------------------------------------------------------------------------
  // Common secret variable assignments
  //
  // Examples:
  //
  // API_KEY = "..."
  // API_SECRET: "..."
  // ACCESS_TOKEN = "..."
  // CLIENT_SECRET = "..."
  // PASSWORD = "..."
  // --------------------------------------------------------------------------

  result = result.replace(
    /(\b(?:API[_-]?KEY|API[_-]?SECRET|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|AUTHORIZATION|CLIENT[_-]?SECRET|CLIENT[_-]?KEY|SECRET[_-]?KEY|PRIVATE[_-]?KEY|PASSWORD|PASSWD|DB[_-]?PASSWORD|DATABASE[_-]?PASSWORD)\b\s*[:=]\s*)(["'`])[^"'`\r\n]*\2/gi,
    "$1[REDACTED_SECRET]"
  );

  // --------------------------------------------------------------------------
  // Common connection strings
  // --------------------------------------------------------------------------

  result = result.replace(
    /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s"'`]+/gi,
    "[REDACTED_DATABASE_URL]"
  );

  // --------------------------------------------------------------------------
  // Generic URL credentials
  //
  // https://username:password@example.com
  // --------------------------------------------------------------------------

  result = result.replace(
    /(https?:\/\/)([^:\s/@]+):([^@\s/]+)@/gi,
    "$1[REDACTED_USER]:[REDACTED_PASSWORD]@"
  );

  return result;
}

// ============================================================================
// FILE FILTERING
// ============================================================================

/**
 * Determines whether a directory should be ignored.
 */
function shouldIgnoreDirectory(dirName) {
  return IGNORED_DIRS.has(dirName);
}

/**
 * Determines whether a file is suitable for the codebase export.
 */
function shouldIncludeFile(filePath) {
  const fileName = path.basename(filePath);
  const extension = path.extname(fileName).toLowerCase();

  // SECURITY: sensitive files always lose
  if (isSensitiveFile(fileName)) {
    return false;
  }

  // Explicit allowed filenames
  if (ALLOWED_FILENAMES.has(fileName)) {
    return true;
  }

  // Allowed extensions
  if (ALLOWED_EXTENSIONS.has(extension)) {
    return true;
  }

  return false;
}

// ============================================================================
// BINARY DETECTION
// ============================================================================

/**
 * Basic binary-file detection.
 *
 * This prevents accidentally putting images, models, audio, etc.
 * into the text export even if they have an unusual extension.
 */
function isBinary(buffer) {
  const sampleSize = Math.min(buffer.length, 8000);

  for (let i = 0; i < sampleSize; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// FILE COLLECTION
// ============================================================================

/**
 * Recursively collect files from a directory.
 */
function collectFiles(currentDir) {
  let entries;

  try {
    entries = fs.readdirSync(currentDir, {
      withFileTypes: true,
    });
  } catch (error) {
    console.warn(
      `⚠️ Could not read directory: ${currentDir}`
    );

    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    // ------------------------------------------------------------------------
    // Directory
    // ------------------------------------------------------------------------

    if (entry.isDirectory()) {
      if (shouldIgnoreDirectory(entry.name)) {
        continue;
      }

      collectFiles(fullPath);
      continue;
    }

    // ------------------------------------------------------------------------
    // File
    // ------------------------------------------------------------------------

    if (!entry.isFile()) {
      continue;
    }

    // Security check FIRST
    if (isSensitiveFile(entry.name)) {
      skippedFiles.push({
        path: path.relative(ROOT_DIR, fullPath),
        reason: "sensitive file",
      });

      continue;
    }

    // File type check
    if (!shouldIncludeFile(fullPath)) {
      skippedFiles.push({
        path: path.relative(ROOT_DIR, fullPath),
        reason: "unsupported file type",
      });

      continue;
    }

    // Size check
    let stats;

    try {
      stats = fs.statSync(fullPath);
    } catch {
      skippedFiles.push({
        path: path.relative(ROOT_DIR, fullPath),
        reason: "could not read file information",
      });

      continue;
    }

    if (stats.size > MAX_FILE_SIZE) {
      skippedFiles.push({
        path: path.relative(ROOT_DIR, fullPath),
        reason: `larger than ${MAX_FILE_SIZE / 1024 / 1024} MB`,
      });

      continue;
    }

    // Read file
    let buffer;

    try {
      buffer = fs.readFileSync(fullPath);
    } catch {
      skippedFiles.push({
        path: path.relative(ROOT_DIR, fullPath),
        reason: "could not read file",
      });

      continue;
    }

    // Binary check
    if (isBinary(buffer)) {
      skippedFiles.push({
        path: path.relative(ROOT_DIR, fullPath),
        reason: "binary file",
      });

      continue;
    }

    const rawContent = buffer.toString("utf8");

    // Redact potential secrets
    const safeContent = redactSecrets(rawContent);

    files.push({
      path: fullPath,
      relativePath: path.relative(ROOT_DIR, fullPath),
      content: safeContent,
    });
  }
}

// ============================================================================
// DIRECTORY TREE
// ============================================================================

/**
 * Generate a clean project directory tree.
 */
function generateTree(dir, prefix = "") {
  let entries;

  try {
    entries = fs
      .readdirSync(dir, {
        withFileTypes: true,
      })
      .filter((entry) => {
        if (entry.isDirectory()) {
          return !shouldIgnoreDirectory(entry.name);
        }

        return shouldIncludeFile(
          path.join(dir, entry.name)
        );
      })
      .sort((a, b) => {
        // Directories first
        if (a.isDirectory() && !b.isDirectory()) {
          return -1;
        }

        if (!a.isDirectory() && b.isDirectory()) {
          return 1;
        }

        return a.name.localeCompare(b.name);
      });
  } catch {
    return "";
  }

  let output = "";

  entries.forEach((entry, index) => {
    const isLast = index === entries.length - 1;

    const connector = isLast
      ? "└── "
      : "├── ";

    output += `${prefix}${connector}${entry.name}\n`;

    if (entry.isDirectory()) {
      const childPrefix =
        prefix + (isLast ? "    " : "│   ");

      output += generateTree(
        path.join(dir, entry.name),
        childPrefix
      );
    }
  });

  return output;
}

// ============================================================================
// FILE FORMATTER
// ============================================================================

/**
 * Format one file for AI consumption.
 */
function formatFile(file) {
  return `
================================================================================
FILE: ${file.relativePath}
================================================================================

${file.content}

================================================================================
END FILE: ${file.relativePath}
================================================================================
`;
}

// ============================================================================
// EXPORT
// ============================================================================

function exportCodebase() {
  console.log("");
  console.log("============================================================");
  console.log("                 ENSO CODEBASE EXPORTER");
  console.log("============================================================");
  console.log("");

  // --------------------------------------------------------------------------
  // Collect files
  // --------------------------------------------------------------------------

  for (const directory of PROJECT_DIRECTORIES) {
    const fullPath = path.join(ROOT_DIR, directory);

    if (!fs.existsSync(fullPath)) {
      console.warn(`⚠️ Directory not found: ${directory}`);
      continue;
    }

    console.log(`📂 Scanning ${directory}/ ...`);

    collectFiles(fullPath);
  }

  // --------------------------------------------------------------------------
  // Sort files
  // --------------------------------------------------------------------------

  files.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  );

  // --------------------------------------------------------------------------
  // Build output
  // --------------------------------------------------------------------------

  let output = "";

  const timestamp = new Date().toISOString();

  // Header
  output += `
================================================================================
                              ENSO CODEBASE
================================================================================

Generated: ${timestamp}

This file contains the source code and configuration of the Enso project.

Sensitive environment files and detected credentials are excluded or redacted.

The export contains the client and server implementation where applicable.

================================================================================
`;

  // --------------------------------------------------------------------------
  // Project structure
  // --------------------------------------------------------------------------

  output += `
                              PROJECT STRUCTURE
================================================================================

`;

  for (const directory of PROJECT_DIRECTORIES) {
    const fullPath = path.join(ROOT_DIR, directory);

    if (!fs.existsSync(fullPath)) {
      continue;
    }

    output += `\n${directory}/\n`;
    output += generateTree(fullPath);
  }

  // --------------------------------------------------------------------------
  // File index
  // --------------------------------------------------------------------------

  output += `
================================================================================
                                FILE INDEX
================================================================================

`;

  files.forEach((file, index) => {
    output += `${String(index + 1).padStart(4, " ")}. ${file.relativePath}\n`;
  });

  // --------------------------------------------------------------------------
  // Source code
  // --------------------------------------------------------------------------

  output += `
================================================================================
                              SOURCE CODE
================================================================================
`;

  for (const file of files) {
    output += formatFile(file);
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------

  output += `
================================================================================
                              EXPORT SUMMARY
================================================================================

Files included : ${files.length}
Files skipped  : ${skippedFiles.length}

`;

  if (skippedFiles.length > 0) {
    output += `Skipped files:\n\n`;

    for (const file of skippedFiles) {
      output += `- ${file.path} (${file.reason})\n`;
    }
  }

  output += `
================================================================================
                              END OF CODEBASE
================================================================================
`;

  // --------------------------------------------------------------------------
  // Write output
  // --------------------------------------------------------------------------

  fs.writeFileSync(
    OUTPUT_FILE,
    output,
    "utf8"
  );

  // --------------------------------------------------------------------------
  // Final security verification
  // --------------------------------------------------------------------------

  const generatedContent = fs.readFileSync(
    OUTPUT_FILE,
    "utf8"
  );

  const envReferences = generatedContent.match(
    /(?:^|\/)\.env(?:\.|$)/gm
  );

  console.log("");
  console.log("============================================================");
  console.log("                       EXPORT COMPLETE");
  console.log("============================================================");
  console.log("");

  console.log(`📄 Output: ${OUTPUT_FILE}`);
  console.log(`📦 Files included: ${files.length}`);
  console.log(`⏭️  Files skipped: ${skippedFiles.length}`);

  // Security warning if an obvious .env filename somehow appears
  if (envReferences && envReferences.length > 0) {
    console.error("");
    console.error(
      "🚨 SECURITY WARNING: An environment-file reference was detected."
    );
    console.error(
      "   Review enso-codebase.txt before sharing it."
    );
  } else {
    console.log("🔐 Environment files: NOT INCLUDED");
  }

  console.log("");
}

// ============================================================================
// RUN
// ============================================================================

try {
  exportCodebase();
} catch (error) {
  console.error("");
  console.error("❌ Export failed:");
  console.error(error);
  process.exit(1);
}