import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Copy generated references and authored content into Nx's runnable artifact. */
export function packageWebsiteContent(sourceDirectory, outputDirectory) {
  const source = path.resolve(sourceDirectory);
  const output = path.resolve(outputDirectory);
  if (
    source === output ||
    output.startsWith(`${source}${path.sep}`) ||
    source.startsWith(`${output}${path.sep}`)
  ) {
    throw new Error('Content source and output directories must be separate');
  }
  if (!fs.existsSync(path.join(source, 'api', 'index.json'))) {
    throw new Error('Generate the API index before packaging website content');
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const staging = fs.mkdtempSync(
    path.join(path.dirname(output), '.website-content-')
  );
  const previous = `${staging}.previous`;
  let published = false;
  try {
    fs.cpSync(source, staging, { recursive: true });
    if (fs.existsSync(output)) fs.renameSync(output, previous);
    try {
      fs.renameSync(staging, output);
      published = true;
    } catch (error) {
      if (fs.existsSync(previous)) fs.renameSync(previous, output);
      throw error;
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    if (published) fs.rmSync(previous, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const website = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  );
  const project = JSON.parse(
    fs.readFileSync(path.join(website, 'project.json'), 'utf8')
  );
  const output = path.resolve(
    website,
    '../..',
    project.targets.build.options.outputPath,
    'content'
  );
  packageWebsiteContent(path.join(website, 'content'), output);
  console.log(
    `Packaged runtime website content: ${project.targets.build.options.outputPath}/content`
  );
}
