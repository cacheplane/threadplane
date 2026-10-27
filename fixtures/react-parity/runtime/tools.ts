/** Authored local handlers shared by the two distinct packaging proofs. */
export function createFixtureTools(onHandler: () => void) {
  return {
    weather: {
      description: 'Current weather',
      handler: ({ city }: { city: string }) => {
        onHandler();
        return { city, temperature: 20 };
      },
    },
    count: {
      description: 'Count values',
      handler: ({ values }: { values: readonly string[] }) => {
        onHandler();
        return values.length;
      },
    },
  };
}
