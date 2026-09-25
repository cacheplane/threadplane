/** Literal observed text. The caller owns tool/result association and formatting. */
export interface ToolObservationProps {
  readonly name: string;
  readonly argumentsText: string;
  readonly resultText?: string;
  readonly label?: string;
}
/** Display supplied tool text without interpreting execution status. */
export function ToolObservation({
  name,
  argumentsText,
  resultText,
  label = 'Tool observation',
}: ToolObservationProps) {
  return (
    <section
      aria-label={label}
      style={{
        color: 'var(--ds-text-primary, #142435)',
        fontFamily: 'inherit',
        overflowWrap: 'anywhere',
      }}
    >
      <h3>{name}</h3>
      <dl style={{ margin: 0 }}>
        <dt style={{ fontWeight: 600 }}>Arguments</dt>
        <dd style={{ margin: 0 }}>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              marginBlock: '.25rem',
            }}
          >
            {argumentsText}
          </pre>
        </dd>
        {resultText !== undefined && (
          <>
            <dt style={{ fontWeight: 600 }}>Result</dt>
            <dd style={{ margin: 0 }}>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  marginBlock: '.25rem',
                }}
              >
                {resultText}
              </pre>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
