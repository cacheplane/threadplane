// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this neutral internal bridge.
import {
  createInspectionRecorder,
  type InspectionFrame,
} from '../../../../../libs/cockpit-runtime-bridge/src/index';
import type { createStreamingApplication } from './application';
export type { InspectionFrame };

type StreamingApplication = ReturnType<typeof createStreamingApplication>;

/** A page owner survives conversation replacement; subscriptions do not. */
export function createStreamingInspection(
  publish: (frame: InspectionFrame) => void
) {
  const recorder = createInspectionRecorder('react', publish);
  let detach = () => undefined as void;
  return {
    attach(application: StreamingApplication) {
      detach();
      let active = true;
      const observe = () => {
        if (!active) return;
        const snapshot = application.getSnapshot();
        recorder.observe({
          messages: snapshot.rows.map((row) => ({
            id: row.id,
            role: row.role,
            text: row.markdown.document.content,
          })),
          busy: snapshot.busy,
          state: {
            creation: snapshot.creation,
            busy: snapshot.busy,
            canSubmit: snapshot.canSubmit,
            outcome: snapshot.outcome,
            hasFailure: snapshot.error !== null,
          },
        });
      };
      const release = application.subscribe(observe);
      detach = () => {
        active = false;
        release();
      };
      observe();
      return detach;
    },
    async submit(application: StreamingApplication, text: string) {
      const id = recorder.startCall(text);
      try {
        const result = await application.submit(text);
        recorder.settleCall(id, 'settled');
        return result;
      } catch (error) {
        recorder.settleCall(id, 'rejected');
        throw error;
      }
    },
    reset() {
      detach();
      recorder.reset();
    },
    dispose() {
      detach();
      recorder.dispose();
    },
  };
}
