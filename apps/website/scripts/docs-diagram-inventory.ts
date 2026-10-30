import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { docsConfig, specialDocsPages } from '../src/lib/docs-config';
import { COCKPIT_DOCS_LINKS } from '@threadplane/cockpit-registry';

/** Discover rendered component tags, excluding authored examples and comments. */
export function diagramPlacements(
  source: string,
  names: readonly string[]
): string[] {
  let fence: { char: string; length: number } | undefined;
  const prose = source
    .split('\n')
    .filter((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = { char: marker[0], length: marker.length };
        else if (marker[0] === fence.char && marker.length >= fence.length)
          fence = undefined;
        return false;
      }
      return !fence;
    })
    .join('\n')
    .replace(/<!--[\s\S]*?-->|\{\/\*[\s\S]*?\*\/\}|`+[^`\n]*`+/g, '');
  return [...prose.matchAll(/<([A-Z]\w*)\b/g)]
    .map((match) => match[1])
    .filter((name) => names.includes(name));
}

/** Parse the actual template literal so TypeScript escaping cannot hide placements. */
export function readReactNarrative(source: string): string {
  const file = ts.createSourceFile(
    'preview.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let narrative: string | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(file) === 'source' &&
      node.initializer &&
      ts.isNoSubstitutionTemplateLiteral(node.initializer)
    )
      narrative = node.initializer.text;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (narrative === undefined)
    throw new Error(
      'React documentation inventory requires a literal source template'
    );
  return narrative;
}

export interface DiagramRouteInventory {
  path: string;
  source: string;
  diagrams: string[];
}

/** Every configured MDX and registered React narrative placement, without a hand-maintained route list. */
export function discoverDiagramRoutes(root: string): DiagramRouteInventory[] {
  const renderer = readFileSync(
    join(root, 'apps/website/src/components/docs/MdxRenderer.tsx'),
    'utf8'
  );
  const imports = /import\s*\{([^}]+)\}\s*from ['"]\.\/diagrams['"]/.exec(
    renderer
  )?.[1];
  if (!imports) throw new Error('No MDX diagram registration found');
  const names = imports
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const configured = new Set(
    docsConfig.flatMap((library) =>
      library.sections.flatMap((section) =>
        section.pages.map(
          (page) => `/docs/${library.id}/${page.section}/${page.slug}`
        )
      )
    )
  );
  specialDocsPages.forEach((page) => configured.add(page.path));
  const directory = join(root, 'apps/website/content/docs');
  const walk = (path: string): string[] =>
    readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(path, entry.name))
        : entry.name.endsWith('.mdx')
        ? [join(path, entry.name)]
        : []
    );
  const targets: DiagramRouteInventory[] = [];
  for (const file of walk(directory)) {
    const diagrams = diagramPlacements(readFileSync(file, 'utf8'), names);
    if (!diagrams.length) continue;
    const relativePath = relative(directory, file);
    const path =
      specialDocsPages.find((page) => page.contentPath === relativePath)
        ?.path ?? `/docs/${relativePath.replace(/\.mdx$/, '')}`;
    if (!configured.has(path))
      throw new Error(
        `Diagram placement has no published route: ${relativePath}`
      );
    targets.push({ path, source: relative(root, file), diagrams });
  }
  const reactDirectory = join(root, 'apps/website/src/components/docs');
  for (const file of readdirSync(reactDirectory).filter((name) =>
    /^React.*Preview\.tsx$/.test(name)
  )) {
    const narrative = readReactNarrative(
      readFileSync(join(reactDirectory, file), 'utf8')
    );
    const diagrams = diagramPlacements(narrative, names);
    if (!diagrams.length) continue;
    const capability =
      /<ExampleCode\s+file=["']cockpit\/([^/]+)\/([^/]+)\/react\//.exec(
        narrative
      );
    if (!capability)
      throw new Error(
        `Cannot resolve React diagram source to a registered capability: ${file}`
      );
    const paths = [
      ...new Set(
        Object.entries(COCKPIT_DOCS_LINKS)
          .filter(([key]) => {
            const [product, , topic] = key.split('/');
            return product === capability[1] && topic === capability[2];
          })
          .map(([, path]) => path)
          .filter(Boolean)
      ),
    ];
    if (paths.length !== 1 || !configured.has(paths[0]))
      throw new Error(`Ambiguous or unpublished React diagram route: ${file}`);
    targets.push({
      path: `${paths[0]}?frontend=react`,
      source: relative(root, join(reactDirectory, file)),
      diagrams,
    });
  }
  if (
    !targets.length ||
    new Set(targets.map((target) => target.path)).size !== targets.length
  )
    throw new Error('Empty or duplicate documentation diagram inventory');
  return targets.sort((a, b) => a.path.localeCompare(b.path));
}
