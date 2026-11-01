const fs = require('node:fs');
const path = require('node:path');

/** Finalize traces without relying on bundler-specific exclusion handling. */
function finalizeWebsiteContentTraces({ projectDir, distDir }) {
  const project = path.resolve(projectDir);
  const output = path.resolve(distDir);
  const workspace = path.resolve(project, '../..');
  const packagedContent = path.join(path.dirname(output), 'content') + path.sep;
  const changes = [];
  let removed = 0;

  const canonicalContent = (file) => {
    if (file.startsWith(packagedContent))
      return path.join(project, 'content', file.slice(packagedContent.length));
    const parts = path.relative(workspace, file).split(path.sep);
    if (
      parts[0] === '.nx' &&
      parts[1] === 'cache' &&
      parts[3] === 'apps' &&
      parts[4] === 'website' &&
      parts[5] === 'content'
    )
      return path.join(project, ...parts.slice(5));
    return null;
  };

  for (const name of fs.readdirSync(output, { recursive: true })) {
    if (!name.endsWith('.nft.json')) continue;
    const file = path.join(output, name);
    const trace = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (
      !Array.isArray(trace.files) ||
      trace.files.some((entry) => typeof entry !== 'string')
    )
      throw new Error(`Invalid website file trace: ${file}`);
    const absolute = new Set(
      trace.files.map((entry) => path.resolve(path.dirname(file), entry))
    );
    const files = trace.files.filter((entry) => {
      const absoluteFile = path.resolve(path.dirname(file), entry);
      const canonical = canonicalContent(absoluteFile);
      if (!canonical || canonical === absoluteFile) return true;
      // Cached snapshots may be stale. The canonical source is authoritative,
      // and must already be a real dependency of this same trace.
      if (!absolute.has(canonical) || !fs.existsSync(canonical))
        throw new Error(
          `Missing canonical content for traced duplicate: ${entry}`
        );
      removed++;
      return false;
    });
    if (files.length !== trace.files.length)
      changes.push({
        file,
        content: JSON.stringify({ ...trace, files }) + '\n',
      });
  }
  // Validate every replacement before modifying any trace.
  for (const { file, content } of changes) fs.writeFileSync(file, content);
  return { traces: changes.length, removed };
}

module.exports = { finalizeWebsiteContentTraces };
