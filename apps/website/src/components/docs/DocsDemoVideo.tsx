import { useId } from 'react';
import {
  getDocsDemo,
  type DocsDemoId,
  type DocsDemoFrontend,
} from '../../lib/docs-demo-media';
import '../../styles/docs-media.css';

/** A focused, reader-controlled recording with captions and a complete text alternative. */
export function DocsDemoVideo({
  demo,
  frontend = 'angular',
}: {
  demo: DocsDemoId;
  frontend?: DocsDemoFrontend;
}) {
  const captionId = useId();
  const media = getDocsDemo(demo, frontend);
  return (
    <figure
      className="docs-demo"
      data-docs-demo-video={demo}
      data-frontend={frontend}
    >
      <video
        key={media.id}
        controls
        playsInline
        preload="none"
        width={media.width}
        height={media.height}
        poster={`${media.base}-poster.png`}
        aria-label={media.title}
        aria-describedby={captionId}
      >
        <source src={`${media.base}.webm`} type="video/webm" />
        <source src={`${media.base}.mp4`} type="video/mp4" />
        <track
          kind="captions"
          src={`${media.base}.vtt`}
          srcLang="en"
          label="English"
          default
        />
        <a href={`${media.base}.mp4`}>Download the recording</a>
      </video>
      <figcaption>
        <p id={captionId}>{media.caption}</p>
        <p className="docs-demo-source" data-docs-demo-provenance>
          {media.recording}{' '}
          <a href={`${media.base}-capture.json`}>Capture details</a>
        </p>
      </figcaption>
      <details data-docs-demo-transcript>
        <summary>Read the walkthrough</summary>
        <ol>
          {media.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <a href={`${media.base}-transcript.txt`}>
          Download the text walkthrough
        </a>
      </details>
    </figure>
  );
}
