/** Neutral UI shapes keep attention on the capability, not fictional data. */
export function LibrarySketch({
  kind,
}: {
  kind: 'components' | 'connections';
}) {
  return (
    <div className="library-sketch" data-kind={kind}>
      <div className="library-sketch-toolbar">
        <i />
        <span />
        <span />
      </div>
      {kind === 'connections' ? (
        <div className="library-connections">
          <div>
            <span />
            <span />
            <span />
          </div>
          <i />
          <b>Agent</b>
          <i />
          <div>
            <span />
            <span />
            <span />
          </div>
        </div>
      ) : (
        <div className="library-components">
          <aside>
            <span />
            <span />
            <span />
          </aside>
          <div>
            <span />
            <div className="library-component-grid">
              <i />
              <i />
              <i />
              <i />
            </div>
            <span />
          </div>
        </div>
      )}
      <div className="library-sketch-lines">
        <span />
        <span />
      </div>
    </div>
  );
}
