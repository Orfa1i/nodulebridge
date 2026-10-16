#!/usr/bin/env node
/**
 * check-copy: fails when product copy breaks the voice rules.
 *
 * Scans (1) every user-visible string in web/src (JSX text, string literals that read as prose, and the text of
 * alt/aria-label/title/placeholder attributes), found with the TypeScript parser, and (2) every string in
 * shared/content/*.json (templates, terms, engine sentences, PDQ excerpts, passport text), both languages.
 *
 * Rules
 *  - no banned word (shared/content/banned-words.json, English and Arabic, case-insensitive);
 *  - no exclamation mark and no emoji;
 *  - no Title Case on buttons and button-like links: only the first word is capitalised (proper nouns and
 *    acronyms from the allow list excepted).
 * The one allowed use of a banned stem is the safety statement itself: "not a diagnosis".
 *
 * Usage: node scripts/check-copy.mjs [--json]    (also: pnpm check-copy, make check-copy)
 * Exit code 1 when anything is found.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Where web/src and shared/content are scanned. CHECK_COPY_ROOT lets a test point it at a folder with deliberately bad copy. */
const ROOT = process.env.CHECK_COPY_ROOT ? resolve(process.env.CHECK_COPY_ROOT) : REPO;
const require = createRequire(join(REPO, "web", "package.json"));
const ts = require("typescript");

const banned = JSON.parse(readFileSync(join(REPO, "shared", "content", "banned-words.json"), "utf8")) /* always the real list */;
const BANNED = [...banned.en, ...banned.ar].filter((w) => w !== "!"); // "!" has its own rule
const ALLOWED_PHRASES = [/not a diagnosis/gi];
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const PROPER = new Set(["WhatsApp", "FHIR", "PDF", "CT", "PET-CT", "DICOM", "NIfTI", "LIDC-IDRI", "NCI", "PDQ", "TCIA", "AI", "English", "Arabic", "Asklevia", "NoduleBridge", "A", "B", "C", "I"]);
const PROSE_ATTRS = new Set(["alt", "aria-label", "title", "placeholder", "aria-description"]);

const findings = [];
const add = (file, line, rule, text) => findings.push({ file: relative(ROOT, file).replaceAll("\\", "/"), line, rule, text: text.length > 90 ? `${text.slice(0, 87)}...` : text });

/** Rules that apply to any piece of copy. */
function checkProse(file, line, text) {
  const scrub = ALLOWED_PHRASES.reduce((t, re) => t.replace(re, ""), text);
  const lowered = scrub.toLowerCase();
  for (const w of BANNED) if (lowered.includes(w.toLowerCase())) add(file, line, `banned word "${w}"`, text);
  if (scrub.includes("!")) add(file, line, "exclamation mark", text);
  if (EMOJI.test(scrub)) add(file, line, "emoji", text);
}

/** Title Case on a button: a second or later word that starts with a capital letter and is not a proper noun or acronym. */
export function titleCaseOffence(label) {
  const words = label.replace(/\([^)]*\)/g, " $& ").split(/\s+/).filter(Boolean);
  const offending = words.slice(1).filter((w) => {
    const bare = w.replace(/^[("“]+|[)”".,:;]+$/g, "");
    return /^[A-Z][a-z]/.test(bare) && !PROPER.has(bare) && !PROPER.has(bare.replace(/-.*/, ""));
  });
  return offending.length > 0;
}

const looksLikeProse = (s) => {
  const t = s.trim();
  if (t.length < 4 || !/[A-Za-z؀-ۿ]/.test(t)) return false;
  if (/^(https?:|\/|#|\.|data:|@\/|\w+:\/\/)/.test(t)) return false;
  if (/^[a-z0-9_.:/#@\[\]\- ]+$/.test(t) && !/[ ]{1}[A-Za-z]{4,} [A-Za-z]{4,}/.test(t)) return false; // class lists, ids, css values
  return /\s/.test(t) || /^[A-Z]/.test(t) || /[؀-ۿ]/.test(t);
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "generated" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

function jsxText(node, sf) {
  let out = "";
  for (const child of node.children ?? []) {
    if (ts.isJsxText(child)) out += child.text;
    else if (ts.isJsxExpression(child) && child.expression && (ts.isStringLiteral(child.expression) || ts.isNoSubstitutionTemplateLiteral(child.expression))) out += child.expression.text;
    else if (ts.isJsxElement(child)) out += jsxText(child, sf);
    else if (ts.isJsxExpression(child)) out += " "; // dynamic part
  }
  return out.replace(/\s+/g, " ").trim();
}

function isButtonLike(opening) {
  const tag = opening.tagName.getText();
  if (tag === "button") return true;
  const cls = opening.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText() === "className");
  return !!cls && /\bak-btn\b/.test(cls.initializer?.getText() ?? "") && /^(button|a|Link)$/.test(tag);
}

function scanSource(file) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const seen = new Set();
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const t = node.text.replace(/\s+/g, " ").trim();
      if (t && looksLikeProse(t)) checkProse(file, lineOf(node), t);
    } else if (ts.isJsxAttribute(node) && PROSE_ATTRS.has(node.name.getText()) && node.initializer && ts.isStringLiteral(node.initializer)) {
      checkProse(file, lineOf(node), node.initializer.text);
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !ts.isJsxAttribute(node.parent)) {
      const p = node.parent;
      const skip = ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isPropertyAssignment(p) && p.name === node || ts.isElementAccessExpression(p) || (ts.isCallExpression(p) && /(getByTestId|locator|querySelector|setItem|getItem|import|require|fetch|log|warn|error)$/.test(p.expression.getText()));
      if (!skip && looksLikeProse(node.text)) {
        const key = `${node.getStart()}`;
        if (!seen.has(key)) {
          seen.add(key);
          checkProse(file, lineOf(node), node.text);
        }
      }
    } else if ((ts.isJsxElement(node) && isButtonLike(node.openingElement)) ) {
      const label = jsxText(node, sf);
      if (label && titleCaseOffence(label)) add(file, lineOf(node), "Title Case on a button", label);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function scanContent() {
  const dir = join(ROOT, "shared", "content");
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json") && n !== "banned-words.json")) {
    const file = join(dir, name);
    const walkJson = (value, path) => {
      if (typeof value === "string") {
        if (value.trim() && !path.split(".").some((k) => k.startsWith("_") || ["status", "reviewer", "date", "url", "retrieved_on", "topic", "id", "source_url", "source_paragraph_starts"].includes(k))) checkProse(file, 0, value);
      } else if (Array.isArray(value)) value.forEach((v, i) => walkJson(v, `${path}.${i}`));
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walkJson(v, `${path}.${k}`);
    };
    walkJson(JSON.parse(readFileSync(file, "utf8")), name);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const f of walk(join(ROOT, "web", "src"))) scanSource(f);
  scanContent();
  if (process.argv.includes("--json")) console.log(JSON.stringify(findings, null, 2));
  else if (findings.length === 0) console.log("check-copy: PASS. No banned words, exclamation marks, emoji or Title Case buttons in the UI strings and the content files.");
  else {
    console.log(`check-copy: FAIL (${findings.length})`);
    for (const f of findings) console.log(`  ${f.file}:${f.line}  ${f.rule}  "${f.text}"`);
  }
  process.exit(findings.length === 0 ? 0 : 1);
}
