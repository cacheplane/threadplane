import { memo } from 'react';
import { TextTranscript } from '@threadplane/react/chat';
import type { ApplicationSnapshot } from '../../shared/application';

type Observations = NonNullable<ApplicationSnapshot['runtime']>['subgraphs'];

export const BackgroundActivity = memo(function BackgroundActivity({
  observations,
}: {
  observations: Observations;
}) {
  if (observations.length === 0) return null;
  return (
    <section className="background-activity" aria-label="Background activity">
      <h2>Background activity</h2>
      {observations.map((observation, index) => (
        <details key={JSON.stringify(observation.namespace)}>
          <summary>Background activity {index + 1}</summary>
          <div className="background-observation">
            <TextTranscript
              messages={observation.messages}
              label={`Background activity ${index + 1} messages`}
            />
            {observation.interrupts.length > 0 && (
              <p>
                Background work has requested a response. This example cannot
                respond here.
              </p>
            )}
            {observation.error && <p>{observation.error.message}</p>}
          </div>
        </details>
      ))}
    </section>
  );
});
