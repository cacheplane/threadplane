/** Decorative sketches explain the shape of a workflow without fictional data. */
export function SolutionSketch({ kind }: { kind: string }) {
  return (
    <div className="solution-sketch" data-kind={kind} aria-hidden="true">
      <div className="solution-sketch-window">
        <div className="solution-sketch-toolbar">
          <i />
          <span />
          <i />
        </div>
        {kind === 'analytics' ? (
          <>
            <div className="solution-sketch-question">
              <i />
              <span />
            </div>
            <div className="solution-sketch-chart">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="solution-sketch-stats">
              <span />
              <span />
              <span />
            </div>
          </>
        ) : kind === 'customer-support' ? (
          <>
            <div className="solution-sketch-message">
              <i />
              <div>
                <span />
                <span />
              </div>
            </div>
            <div className="solution-sketch-reply">
              <span />
              <span />
              <span />
            </div>
            <div className="solution-sketch-handoff">
              <i />
              <span />
              <b>Human handoff</b>
            </div>
            <div className="solution-sketch-context">
              <span />
              <span />
            </div>
          </>
        ) : (
          <>
            <div className="solution-sketch-records">
              {[0, 1, 2].map((row) => (
                <div key={row}>
                  <i />
                  <span />
                  <span />
                </div>
              ))}
            </div>
            <div className="solution-sketch-approval">
              <span />
              <span />
              <b>Review before action</b>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
