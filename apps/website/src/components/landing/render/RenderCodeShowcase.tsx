import { HighlightedCode } from '../HighlightedCode';

const SNIPPET_1 = `import { defineAngularRegistry } from '@threadplane/render';
import { TableComponent } from './table.component';
import { ChartComponent } from './chart.component';

const registry = defineAngularRegistry({
  table: TableComponent,
  chart: ChartComponent,
  form: FormComponent,
});`;

const SNIPPET_2 = `<render-spec
  [spec]="agentOutput()"
  [registry]="registry"
  [store]="stateStore"
/>`;

const SNIPPETS = [
  { title: 'Registry Setup', code: SNIPPET_1, lang: 'typescript' },
  { title: 'Template Binding', code: SNIPPET_2, lang: 'html' },
];

export async function RenderCodeShowcase({
  showIntroduction = true,
}: { showIntroduction?: boolean } = {}) {
  return (
    <section
      className={showIntroduction ? 'render-code' : 'library-compact-code'}
    >
      {showIntroduction && (
        <div className="render-show-intro">
          <div className="show-intro-rail">
            <p className="render-show-eyebrow">Developer Experience</p>
            <span className="show-intro-rail-line" aria-hidden="true" />
          </div>
          <h2 className="render-show-heading">Generative UI in a few lines</h2>
        </div>
      )}

      <div className="render-show-grid">
        {SNIPPETS.map((s) => (
          <div key={s.title} className="render-show-card">
            <div className="render-show-card-head">
              <span className="render-show-card-title">{s.title}</span>
            </div>
            <HighlightedCode code={s.code} lang={s.lang} />
          </div>
        ))}
      </div>
    </section>
  );
}
