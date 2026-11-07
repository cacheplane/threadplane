export function PilotSketch({
  kind,
  takeaway,
}: {
  kind: 'plan' | 'build' | 'launch';
  takeaway: string;
}) {
  return (
    <div className="pilot-sketch" aria-hidden="true" data-kind={kind}>
      <div className="pilot-sketch-window">
        <div className="pilot-sketch-toolbar">
          <i />
          <span />
        </div>
        {kind === 'plan' ? (
          <div className="pilot-sketch-plan">
            {[0, 1, 2].map((row) => (
              <div key={row}>
                <i />
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : kind === 'build' ? (
          <div className="pilot-sketch-build">
            <aside>
              <span />
              <span />
              <span />
            </aside>
            <div>
              <span />
              <span />
              <section>
                <i />
                <span />
                <span />
              </section>
              <span />
            </div>
          </div>
        ) : (
          <div className="pilot-sketch-launch">
            {[0, 1, 2, 3].map((row) => (
              <div key={row}>
                <i>✓</i>
                <span />
              </div>
            ))}
          </div>
        )}
        <p>{takeaway}</p>
      </div>
    </div>
  );
}
