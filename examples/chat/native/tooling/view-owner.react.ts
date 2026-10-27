import { createA2uiSurfaces } from '@threadplane/content/a2ui';
import { createReactApplication } from '../react/src/application';
import { createViewOwner } from './view-owner';

// Observe the installed raw owner through the production factory's private seam.
// No proof path authors envelopes, rows, or RenderSpecs.
export function createReactViewOwner() {
  const rawOwners: {
    raw: ReturnType<typeof createA2uiSurfaces>;
    applies: number;
    disposals: number;
  }[] = [];
  const proof = createViewOwner((options) =>
    createReactApplication({
      ...options,
      a2ui: {
        ownerFactory() {
          const raw = createA2uiSurfaces();
          const record = { raw, applies: 0, disposals: 0 };
          rawOwners.push(record);
          return {
            getSnapshot: raw.getSnapshot,
            apply(message) {
              record.applies++;
              return raw.apply(message);
            },
            dispose() {
              record.disposals++;
              raw.dispose();
            },
          };
        },
      },
    })
  );
  const marks = new Map<
    string,
    {
      raw: ReturnType<ReturnType<typeof createA2uiSurfaces>['getSnapshot']>[];
      prepared: ReturnType<
        typeof proof.owner.getSnapshot
      >['messages'][number]['a2uiTripSummaryRenders'][number][];
    }
  >();
  const prepared = () =>
    proof.owner
      .getSnapshot()
      .messages.flatMap((row) => row.a2uiTripSummaryRenders);
  return {
    ...proof,
    controls: {
      ...proof.controls,
      select(id: string | null) {
        proof.owner.select(id);
      },
      mark(name: string) {
        proof.controls.mark(name);
        marks.set(name, {
          raw: rawOwners.map(({ raw }) => raw.getSnapshot()),
          prepared: prepared(),
        });
      },
      compare(name: string) {
        const before = marks.get(name)!;
        const current = prepared();
        return {
          ...proof.controls.compare(name),
          rawSnapshots:
            before.raw.length > 0 &&
            before.raw.length === rawOwners.length &&
            before.raw.every(
              (snapshot, i) => snapshot === rawOwners[i].raw.getSnapshot()
            ),
          preparedCards:
            before.prepared.length > 0 &&
            before.prepared.length === current.length &&
            before.prepared.every((card, i) => card === current[i]),
        };
      },
      inspect() {
        return {
          ...proof.controls.inspect(),
          raw: {
            created: rawOwners.length,
            applies: rawOwners.reduce((n, owner) => n + owner.applies, 0),
            disposed: rawOwners.reduce((n, owner) => n + owner.disposals, 0),
            active: rawOwners.filter((owner) => owner.disposals === 0).length,
            disposalCounts: rawOwners.map((owner) => owner.disposals),
            // Read real snapshots even after disposal: the raw owner retains them.
            titles: rawOwners.flatMap(({ raw }) =>
              raw
                .getSnapshot()
                .surfaces.flatMap((surface) =>
                  surface.components
                    .filter((component) => component.component === 'Trip')
                    .map((component) => component['title'])
                )
            ),
          },
          preparedCardCount: prepared().length,
          generations: proof.owner
            .getSnapshot()
            .messages.filter((row) => row.a2uiTripSummaryRenders.length)
            .map((row) => ({
              id: row.message.id,
              generation: row.message.delivery.generation,
            })),
          ownerEpochs: rawOwners.map(({ raw, disposals }, index) => ({
            id: index + 1,
            disposed: disposals > 0,
            surfaces: raw
              .getSnapshot()
              .surfaces.map((surface) => surface.surfaceId),
          })),
        };
      },
    },
  };
}
